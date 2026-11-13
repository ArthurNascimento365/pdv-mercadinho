import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { montarEtiquetaBalanca, type FormatoBalanca } from '@shared/balanca'
import type { Produto } from '@shared/produtos'
import type { ResultadoAdicionar, Venda } from '@shared/vendas'
import { abrirCaixa } from '../../src/main/caixa/caixa'
import { abrirBanco, type Banco } from '../../src/main/db/conexao'
import { definirConfigAPrazo } from '../../src/main/repos/configuracoes'
import { criarProduto, obterProduto } from '../../src/main/repos/produtos'
import {
  acrescimoVenda,
  adicionarPagamento,
  adicionarPorCodigo,
  adicionarProduto,
  alterarQuantidade,
  alterarTabelaItem,
  cancelarItem,
  cancelarVendaAberta,
  cancelarVendaFinalizada,
  descontoItem,
  descontoVenda,
  finalizarVenda,
  opcoesTabelaItem,
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
      const v = adicionarProduto(db, banana.id, 500)
      expect(v.status).toBe('aberta')
      expect(v.itens.map((i) => [i.sequencia, i.produtoId, i.quantidade])).toEqual([
        [1, leite.id, 1000],
        [2, banana.id, 500]
      ])
      expect(v.total).toBe(749 + v.itens[1]!.total)
    })

    it('bipar de novo o mesmo produto por unidade soma na mesma linha', () => {
      bipar(EAN_LEITE)
      const v = venda(bipar(EAN_LEITE, 2000))
      expect(v.itens.map((i) => [i.sequencia, i.quantidade, i.total])).toEqual([[1, 3000, 2247]])
      expect(v.total).toBe(2247)
      // Linha cancelada não recebe a soma: o próximo bipe abre linha nova.
      cancelarItem(db, v.itens[0]!.id)
      const depois = venda(bipar(EAN_LEITE))
      expect(depois.itens.map((i) => [i.sequencia, i.quantidade, i.cancelado])).toEqual([
        [1, 3000, true],
        [2, 1000, false]
      ])
    })

    it('produto por quilo: cada pesagem fica numa linha', () => {
      adicionarProduto(db, banana.id, 500)
      expect(adicionarProduto(db, banana.id, 700).itens.map((i) => i.quantidade)).toEqual([500, 700])
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

    it('acréscimo soma no total, junto com o desconto, e entra no pagamento', () => {
      venda(bipar(EAN_LEITE, 2000)) // 14,98
      descontoVenda(db, 98)
      const v = acrescimoVenda(db, 150)
      expect([v.subtotal, v.desconto, v.acrescimo, v.total]).toEqual([1498, 98, 150, 1550])
      // Item novo: o acréscimo (em reais) continua o mesmo.
      expect(venda(bipar(EAN_LEITE)).total).toBe(2247 - 98 + 150)
      expect(acrescimoVenda(db, 0).total).toBe(2247 - 98)
      acrescimoVenda(db, 300)
      adicionarPagamento(db, 'dinheiro', 2247 - 98)
      expect(() => finalizarVenda(db)).toThrow(/Falta receber R\$\s3,00/)
      adicionarPagamento(db, 'pix', 300)
      expect(finalizarVenda(db)).toMatchObject({ status: 'finalizada', acrescimo: 300, total: 2449, troco: 0 })
    })

    it('acréscimo: recusa valor inválido e zera quando a venda fica sem itens', () => {
      const v = venda(bipar(EAN_LEITE))
      expect(() => acrescimoVenda(db, -1)).toThrow(/inválido/)
      expect(() => acrescimoVenda(db, 1.5)).toThrow(/inválido/)
      expect(() => acrescimoVenda(db, 10_000_001)).toThrow(/alto demais/)
      acrescimoVenda(db, 500)
      const depois = cancelarItem(db, v.itens[0]!.id)
      expect([depois.subtotal, depois.acrescimo, depois.total]).toEqual([0, 0, 0])
      expect(() => acrescimoVenda(db, 100)).toThrow(/sem itens/)
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

    it('finaliza com saldo devedor: o que falta fica registrado, sem cliente', () => {
      adicionarPagamento(db, 'dinheiro', 2000)
      expect(() => finalizarVenda(db)).toThrow(/Falta receber R\$\s2,47/)
      const v = finalizarVenda(db, true)
      expect(v).toMatchObject({ status: 'finalizada', pago: 2000, troco: 0, saldoDevedor: 247, clienteId: null })
      expect(obterProduto(db, leite.id)!.estoqueAtual).toBe(7_000)
    })

    it('saldo devedor exige ao menos um pagamento; venda paga fica com saldo 0', () => {
      expect(() => finalizarVenda(db, true)).toThrow(/pagou/)
      adicionarPagamento(db, 'pix', 2247)
      expect(finalizarVenda(db, true)).toMatchObject({ saldoDevedor: 0, troco: 0 })
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

    it('dois cartões, e Pix + cartão, fecham a venda sem troco', () => {
      adicionarPagamento(db, 'credito', 1000)
      adicionarPagamento(db, 'credito', 1247) // segundo cartão
      expect(finalizarVenda(db)).toMatchObject({ pago: 2247, troco: 0 })

      bipar(EAN_LEITE, 3000)
      adicionarPagamento(db, 'pix', 2000)
      expect(() => adicionarPagamento(db, 'debito', 248)).toThrow(/maior que o restante \(R\$\s2,47\)/)
      adicionarPagamento(db, 'debito', 247)
      const v = finalizarVenda(db)
      expect(v.pagamentos.map((p) => [p.forma, p.valor])).toEqual([
        ['pix', 2000],
        ['debito', 247]
      ])
      expect(v.troco).toBe(0)
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
      const v = adicionarProduto(db, banana.id, 500)
      cancelarItem(db, v.itens[1]!.id)
      adicionarPagamento(db, 'dinheiro', 2247)
      finalizarVenda(db)
      expect(obterProduto(db, leite.id)!.estoqueAtual).toBe(7_000)
      expect(obterProduto(db, banana.id)!.estoqueAtual).toBe(20_000)
    })

    it('venda só com itens cancelados não finaliza', () => {
      const v = vendaAberta(db)!
      cancelarItem(db, v.itens[0]!.id)
      expect(() => finalizarVenda(db)).toThrow(/sem itens/)
    })
  })

  describe('tabela A prazo (por item, interna)', () => {
    const aPrazo = (percentual: number) => definirConfigAPrazo(db, { percentual, perguntar: true })

    it('item entra no varejo; a prazo usa o percentual e volta ao varejo', () => {
      aPrazo(800) // 8%
      const v = venda(bipar(EAN_LEITE, 2000)) // 2 × 7,49
      const item = v.itens[0]!
      expect(item.tabela).toBe('varejo')
      expect(opcoesTabelaItem(db, item.id)).toEqual({ varejo: 749, aPrazo: 809 }) // 8,0892
      const ap = alterarTabelaItem(db, item.id, 'a_prazo')
      expect(ap.itens[0]).toMatchObject({ tabela: 'a_prazo', precoUnitario: 809, total: 1618 })
      expect(ap.total).toBe(1618)
      const volta = alterarTabelaItem(db, item.id, 'varejo')
      expect(volta.itens[0]).toMatchObject({ tabela: 'varejo', precoUnitario: 749, total: 1498 })
    })

    it('mesma venda com itens em tabelas diferentes', () => {
      aPrazo(1000)
      const arroz = criarProduto(db, entrada({ descricao: 'Arroz 5kg', precoVenda: 2_500 }))
      bipar(EAN_LEITE)
      const v = adicionarProduto(db, arroz.id, 1000)
      const depois = alterarTabelaItem(db, v.itens[0]!.id, 'a_prazo')
      expect(depois.itens.map((i) => [i.tabela, i.precoUnitario])).toEqual([
        ['a_prazo', 824], // 8,239
        ['varejo', 2_500]
      ])
      expect(depois.total).toBe(824 + 2_500)
    })

    it('somar na linha mantém a tabela escolhida', () => {
      aPrazo(1000)
      const v = venda(bipar(EAN_LEITE))
      alterarTabelaItem(db, v.itens[0]!.id, 'a_prazo')
      const depois = venda(bipar(EAN_LEITE))
      expect(depois.itens.map((i) => [i.tabela, i.quantidade, i.total])).toEqual([['a_prazo', 2000, 1648]])
    })

    it('preço fixo do produto vale no lugar do percentual', () => {
      aPrazo(1000)
      const gas = criarProduto(db, entrada({ descricao: 'Gás 13kg', precoVenda: 11_000, precoAPrazo: 12_500 }))
      const v = adicionarProduto(db, gas.id, 1000)
      expect(opcoesTabelaItem(db, v.itens[0]!.id)).toEqual({ varejo: 11_000, aPrazo: 12_500 })
      expect(alterarTabelaItem(db, v.itens[0]!.id, 'a_prazo').itens[0]!.precoUnitario).toBe(12_500)
    })

    it('sem percentual e sem preço fixo não há o que escolher', () => {
      const v = venda(bipar(EAN_LEITE))
      expect(opcoesTabelaItem(db, v.itens[0]!.id)).toBeNull()
    })

    it('mantém o desconto do item e o atacarejo vem antes do acréscimo', () => {
      aPrazo(1000)
      const refri = criarProduto(db, entrada({ descricao: 'Refri', precoVenda: 900, atacadoQuantidade: 3000, atacadoPreco: 800 }))
      const v1 = adicionarProduto(db, refri.id, 3000) // atacado: 3 × 8,00
      descontoItem(db, v1.itens[0]!.id, 100)
      const v2 = alterarTabelaItem(db, v1.itens[0]!.id, 'a_prazo')
      expect(v2.itens[0]).toMatchObject({ precoUnitario: 880, tipoPreco: 'atacado', desconto: 100, total: 2540 })
      // caiu do atacado (quantidade 2): volta para 9,00 + 10%
      const v3 = alterarQuantidade(db, v1.itens[0]!.id, 2000)
      expect(v3.itens[0]).toMatchObject({ precoUnitario: 990, tipoPreco: 'normal', total: 1880 })
    })

    it('etiqueta de balança fica no preço impresso', () => {
      aPrazo(1000)
      const v = venda(bipar(montarEtiquetaBalanca({ codigoProduto: 12, valor: 836 }, FORMATO)))
      expect(opcoesTabelaItem(db, v.itens[0]!.id)).toBeNull()
      expect(() => alterarTabelaItem(db, v.itens[0]!.id, 'a_prazo')).toThrow(/etiqueta de balança/)
    })

    it('recusa tabela inválida e configuração fora da faixa', () => {
      const v = venda(bipar(EAN_LEITE))
      expect(() => alterarTabelaItem(db, v.itens[0]!.id, 'atacado')).toThrow(/Tabela de preço inválida/)
      expect(() => aPrazo(-1)).toThrow(/0% a 100%/)
      expect(() => criarProduto(db, entrada({ descricao: 'X', precoVenda: 500, precoAPrazo: 500 }))).toThrow(
        /maior que o de venda/
      )
    })
  })
describe('preço livre', () => {
    const diversos = () =>
      criarProduto(db, entrada({ descricao: 'DIVERSOS', codigoBalanca: 1, precoVenda: 0, precoCusto: null, estoqueAtual: 5_000, precoLivre: true }))

    it('cadastro: preço e estoque não valem, só por unidade', () => {
      const p = diversos()
      expect(p).toMatchObject({ precoLivre: true, precoVenda: 1, estoqueAtual: 0, estoqueMinimo: 0 })
      expect(() => criarProduto(db, entrada({ descricao: 'X', unidade: 'KG', precoLivre: true }))).toThrow(/por unidade/)
    })

    it('o código pede o valor; cada valor vira uma linha, sem baixar estoque', () => {
      const p = diversos()
      expect(bipar('1')).toEqual({ tipo: 'pedirPreco', produto: p, quantidade: 1000 })
      expect(bipar('1', 3000)).toMatchObject({ tipo: 'pedirPreco', quantidade: 3000 })
      expect(() => adicionarProduto(db, p.id, 1000)).toThrow(/Valor inválido/)
      expect(() => adicionarProduto(db, p.id, 1000, 0)).toThrow(/Informe o valor/)
      expect(() => adicionarProduto(db, leite.id, 1000, 500)).toThrow(/preço no cadastro/)
      adicionarProduto(db, p.id, 1000, 1000)
      bipar(EAN_LEITE)
      const v = adicionarProduto(db, p.id, 2000, 350)
      expect(v.itens.map((i) => [i.descricao, i.quantidade, i.precoUnitario, i.total])).toEqual([
        ['DIVERSOS', 1000, 1000, 1000],
        ['Leite Condensado', 1000, 749, 749],
        ['DIVERSOS', 2000, 350, 700]
      ])
      expect(v.total).toBe(2449)
      expect(opcoesTabelaItem(db, v.itens[0]!.id)).toBeNull()
      adicionarPagamento(db, 'dinheiro', 2449)
      const fin = finalizarVenda(db)
      expect(obterProduto(db, p.id)!.estoqueAtual).toBe(0)
      expect(obterProduto(db, leite.id)!.estoqueAtual).toBe(9_000)
      cancelarVendaFinalizada(db, fin.id)
      expect(obterProduto(db, p.id)!.estoqueAtual).toBe(0)
      expect(obterProduto(db, leite.id)!.estoqueAtual).toBe(10_000)
    })

    it('alterar a quantidade mantém o valor digitado', () => {
      const p = diversos()
      const v = adicionarProduto(db, p.id, 1000, 1250)
      expect(alterarQuantidade(db, v.itens[0]!.id, 2000).total).toBe(2500)
    })
  })
})
