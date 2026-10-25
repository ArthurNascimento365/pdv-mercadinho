import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { montarEtiquetaBalanca, type FormatoBalanca } from '@shared/balanca'
import type { Produto } from '@shared/produtos'
import type { ResultadoAdicionar, Venda } from '@shared/vendas'
import { abrirCaixa } from '../../src/main/caixa/caixa'
import { abrirBanco, type Banco } from '../../src/main/db/conexao'
import { criarProduto, obterProduto } from '../../src/main/repos/produtos'
import {
  adicionarPagamento,
  adicionarPorCodigo,
  adicionarProduto,
  alterarQuantidade,
  cancelarItem,
  cancelarVendaAberta,
  cancelarVendaFinalizada,
  descontoItem,
  descontoVenda,
  finalizarVenda,
  removerPagamento,
  ultimaVendaFinalizada,
  vendaAberta
} from '../../src/main/vendas/vendas'
import { entrada } from '../ajuda'

const FORMATO: FormatoBalanca = { digitosCodigo: 4, tipoValor: 'preco' }
const EAN_LEITE = '7891000100103'

describe('vendas', () => {
  let db: Banco
  let leite: Produto // R$ 7,49 un
  let banana: Produto // R$ 6,99/kg, PLU 12

  beforeEach(() => {
    db = abrirBanco(':memory:')
    abrirCaixa(db, 'Teste', 0)
    leite = criarProduto(db, entrada({ ean: EAN_LEITE, descricao: 'Leite Condensado', precoVenda: 749, estoqueAtual: 10_000 }))
    banana = criarProduto(
      db,
      entrada({ descricao: 'Banana', unidade: 'KG', precoVenda: 699, codigoBalanca: 12, estoqueAtual: 20_000 })
    )
  })

  const venda = (r: ResultadoAdicionar): Venda => {
    if (r.tipo !== 'adicionado') throw new Error(`esperava adicionado, veio ${r.tipo}`)
    return r.venda
  }
  const bipar = (codigo: string, quantidade: number | null = null) =>
    adicionarPorCodigo(db, codigo, quantidade, FORMATO)

  describe('itens', () => {
    it('abre a venda no primeiro item e numera em sequência', () => {
      expect(vendaAberta(db)).toBeNull()
      bipar(EAN_LEITE)
      const v = venda(bipar(EAN_LEITE, 2000))
      expect(v.status).toBe('aberta')
      expect(v.itens.map((i) => [i.sequencia, i.quantidade, i.total])).toEqual([
        [1, 1000, 749],
        [2, 2000, 1498]
      ])
      expect(v.total).toBe(2247)
    })

    it('etiqueta de balança usa o total impresso', () => {
      const v = venda(bipar(montarEtiquetaBalanca({ codigoProduto: 12, valor: 836 }, FORMATO)))
      expect(v.itens[0]).toMatchObject({ descricao: 'Banana', total: 836, quantidade: 1196 })
    })

    it('produto pesado sem etiqueta pede o peso; PLU digitado também', () => {
      expect(bipar('12')).toMatchObject({ tipo: 'pedirQuantidade', produto: { id: banana.id } })
      const v = adicionarProduto(db, banana.id, 350)
      expect(v.itens[0]).toMatchObject({ quantidade: 350, total: 245 }) // 2,4465
      expect(venda(bipar('12', 1500)).itens[1]).toMatchObject({ total: 1049 }) // 10,485
    })

    it('código desconhecido não abre venda', () => {
      expect(bipar('7891000100110')).toEqual({ tipo: 'naoEncontrado', codigo: '7891000100110' })
      expect(vendaAberta(db)).toBeNull()
    })

    it('recusa quantidade fracionada de produto por unidade e multiplicador em etiqueta', () => {
      expect(() => bipar(EAN_LEITE, 1500)).toThrow(/quantidade inteira/)
      const etiqueta = montarEtiquetaBalanca({ codigoProduto: 12, valor: 836 }, FORMATO)
      expect(() => bipar(etiqueta, 2000)).toThrow(/Multiplicador/)
    })

    it('guarda a descrição e o preço do momento da venda', () => {
      const v = venda(bipar(EAN_LEITE))
      db.prepare('UPDATE produtos SET preco_venda = 999, descricao = ? WHERE id = ?').run('Outro', leite.id)
      expect(vendaAberta(db)!.itens[0]).toMatchObject({ id: v.itens[0]!.id, descricao: 'Leite Condensado', precoUnitario: 749 })
    })

    it('volta a venda aberta depois de reabrir o banco (queda do PDV)', () => {
      const pasta = mkdtempSync(join(tmpdir(), 'pdv-'))
      try {
        const caminho = join(pasta, 'pdv.db')
        const antes = abrirBanco(caminho)
        abrirCaixa(antes, 'Teste', 0)
        const p = criarProduto(antes, entrada({ ean: EAN_LEITE }))
        adicionarProduto(antes, p.id, 2000)
        antes.close()

        const depois = abrirBanco(caminho)
        expect(vendaAberta(depois)?.itens).toMatchObject([{ produtoId: p.id, quantidade: 2000 }])
        depois.close()
      } finally {
        rmSync(pasta, { recursive: true, force: true })
      }
    })
  })

  describe('desconto e cancelamento', () => {
    it('desconto no item e na venda', () => {
      const v1 = venda(bipar(EAN_LEITE, 2000)) // 14,98
      const v2 = descontoItem(db, v1.itens[0]!.id, 98)
      expect(v2.itens[0]).toMatchObject({ desconto: 98, total: 1400 })
      const v3 = descontoVenda(db, 400)
      expect([v3.subtotal, v3.desconto, v3.total]).toEqual([1400, 400, 1000])
    })

    it('não deixa desconto passar do valor', () => {
      const v = venda(bipar(EAN_LEITE))
      expect(() => descontoItem(db, v.itens[0]!.id, 750)).toThrow(/maior que o item/)
      expect(() => descontoVenda(db, 750)).toThrow(/maior que a venda/)
      expect(() => descontoVenda(db, -1)).toThrow(/inválido/)
    })

    it('cancelar item tira do total e reduz o desconto da venda se precisar', () => {
      bipar(EAN_LEITE)
      const v = venda(bipar('12', 1000)) // 7,49 + 6,99
      descontoVenda(db, 1000)
      const depois = cancelarItem(db, v.itens[0]!.id)
      expect(depois.itens[0]!.cancelado).toBe(true)
      expect([depois.subtotal, depois.desconto, depois.total]).toEqual([699, 699, 0])
      expect(() => cancelarItem(db, v.itens[0]!.id)).toThrow(/já foi cancelado/)
    })

    it('alterar a quantidade recalcula o item e a venda, limitando o desconto', () => {
      const v1 = venda(bipar(EAN_LEITE, 2000)) // 14,98
      descontoItem(db, v1.itens[0]!.id, 1000)
      const v2 = alterarQuantidade(db, v1.itens[0]!.id, 3000)
      expect(v2.itens[0]).toMatchObject({ quantidade: 3000, totalBruto: 2247, desconto: 1000, total: 1247 })
      expect(v2.total).toBe(1247)
      const v3 = alterarQuantidade(db, v1.itens[0]!.id, 1000) // 7,49: desconto cai para o valor do item
      expect(v3.itens[0]).toMatchObject({ desconto: 749, total: 0 })
      expect(() => alterarQuantidade(db, v1.itens[0]!.id, 1500)).toThrow(/quantidade inteira/)
      expect(() => alterarQuantidade(db, v1.itens[0]!.id, 0)).toThrow(/inválida/)
    })

    it('alterar a quantidade aceita peso e recusa item de etiqueta ou cancelado', () => {
      const v = venda(bipar('12', 1000)) // banana 6,99
      expect(alterarQuantidade(db, v.itens[0]!.id, 500).itens[0]).toMatchObject({ quantidade: 500, total: 350 })
      const etiqueta = venda(bipar(montarEtiquetaBalanca({ codigoProduto: 12, valor: 836 }, FORMATO))).itens[1]!
      expect(() => alterarQuantidade(db, etiqueta.id, 2000)).toThrow(/etiqueta de balança/)
      cancelarItem(db, v.itens[0]!.id)
      expect(() => alterarQuantidade(db, v.itens[0]!.id, 2000)).toThrow(/já foi cancelado/)
    })

    it('cancelar a venda aberta libera para uma nova', () => {
      const primeira = venda(bipar(EAN_LEITE))
      cancelarVendaAberta(db)
      expect(vendaAberta(db)).toBeNull()
      const segunda = venda(bipar(EAN_LEITE))
      expect(segunda.id).not.toBe(primeira.id)
      expect(obterProduto(db, leite.id)!.estoqueAtual).toBe(10_000)
    })
  })

  describe('pagamento', () => {
    beforeEach(() => {
      bipar(EAN_LEITE, 3000) // 22,47
    })

    it('dinheiro com troco', () => {
      adicionarPagamento(db, 'dinheiro', 5000)
      const v = finalizarVenda(db)
      expect(v).toMatchObject({ status: 'finalizada', pago: 5000, troco: 2753 })
      expect(vendaAberta(db)).toBeNull()
    })

    it('pagamentos múltiplos', () => {
      const v1 = adicionarPagamento(db, 'pix', 1000)
      expect(v1.restante).toBe(1247)
      adicionarPagamento(db, 'debito', 1000)
      adicionarPagamento(db, 'dinheiro', 500)
      const v = finalizarVenda(db)
      expect(v.pagamentos.map((p) => p.forma)).toEqual(['pix', 'debito', 'dinheiro'])
      expect(v.troco).toBe(253)
    })

    it('cartão e Pix não passam do restante', () => {
      expect(() => adicionarPagamento(db, 'credito', 2248)).toThrow(/maior que o restante/)
      expect(() => adicionarPagamento(db, 'cheque', 100)).toThrow(/Forma de pagamento/)
      expect(() => adicionarPagamento(db, 'dinheiro', 0)).toThrow(/Informe o valor/)
    })

    it('não finaliza faltando dinheiro', () => {
      adicionarPagamento(db, 'dinheiro', 2000)
      expect(() => finalizarVenda(db)).toThrow(/Falta receber R\$\s2,47/)
    })

    it('remover pagamento lançado errado', () => {
      const v = adicionarPagamento(db, 'dinheiro', 50_000)
      const depois = removerPagamento(db, v.pagamentos[0]!.id)
      expect(depois.pagamentos).toEqual([])
    })

    it('revalida cartão se itens mudaram depois do pagamento', () => {
      adicionarPagamento(db, 'credito', 2247)
      const v = vendaAberta(db)!
      descontoItem(db, v.itens[0]!.id, 247)
      expect(() => finalizarVenda(db)).toThrow(/passam do total/)
    })

    it('baixa o estoque só ao finalizar, e a venda cancelada devolve', () => {
      expect(obterProduto(db, leite.id)!.estoqueAtual).toBe(10_000)
      adicionarPagamento(db, 'dinheiro', 2247)
      const v = finalizarVenda(db)
      expect(obterProduto(db, leite.id)!.estoqueAtual).toBe(7_000)

      expect(ultimaVendaFinalizada(db)?.id).toBe(v.id)
      cancelarVendaFinalizada(db, v.id)
      expect(obterProduto(db, leite.id)!.estoqueAtual).toBe(10_000)
      expect(ultimaVendaFinalizada(db)).toBeNull()
      expect(() => cancelarVendaFinalizada(db, v.id)).toThrow(/não está finalizada/)
    })

    it('item cancelado não baixa estoque', () => {
      const v = venda(bipar(EAN_LEITE))
      cancelarItem(db, v.itens[1]!.id)
      adicionarPagamento(db, 'dinheiro', 2247)
      finalizarVenda(db)
      expect(obterProduto(db, leite.id)!.estoqueAtual).toBe(7_000)
    })

    it('venda só com itens cancelados não finaliza', () => {
      const v = vendaAberta(db)!
      cancelarItem(db, v.itens[0]!.id)
      expect(() => finalizarVenda(db)).toThrow(/sem itens/)
    })
  })
})
