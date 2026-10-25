import { beforeEach, describe, expect, it } from 'vitest'
import type { Contagem } from '@shared/caixa'
import { abrirBanco, type Banco } from '../../src/main/db/conexao'
import {
  abrirCaixa,
  caixaAberto,
  caixaParaVender,
  controleCaixaLigado,
  definirControleCaixa,
  fecharCaixa,
  listarCaixas,
  movimentarCaixa,
  OPERADOR_AUTOMATICO
} from '../../src/main/caixa/caixa'
import { criarProduto } from '../../src/main/repos/produtos'
import {
  adicionarPagamento,
  adicionarProduto,
  cancelarVendaFinalizada,
  finalizarVenda
} from '../../src/main/vendas/vendas'
import { entrada } from '../ajuda'

describe('caixa', () => {
  let db: Banco
  let produtoId: number // R$ 10,00

  beforeEach(() => {
    db = abrirBanco(':memory:')
    produtoId = criarProduto(db, entrada({ precoVenda: 1000 })).id
  })

  function vender(unidades: number, pagamentos: [Parameters<typeof adicionarPagamento>[1], number][]) {
    adicionarProduto(db, produtoId, unidades * 1000)
    for (const [forma, valor] of pagamentos) adicionarPagamento(db, forma, valor)
    return finalizarVenda(db)
  }

  const contagem = (c: Partial<Contagem>): Contagem => ({ dinheiro: 0, debito: 0, credito: 0, pix: 0, ...c })

  it('não vende com o caixa fechado', () => {
    expect(() => adicionarProduto(db, produtoId, 1000)).toThrow(/caixa está fechado/)
  })

  describe('controle de caixa desligado (dono único)', () => {
    it('vem ligado e caixaParaVender não abre nada', () => {
      expect(controleCaixaLigado(db)).toBe(true)
      expect(caixaParaVender(db)).toBeNull()
    })

    it('abre um caixa sozinho na primeira venda e o reaproveita', () => {
      definirControleCaixa(db, false)
      const v = vender(2, [['dinheiro', 2000]])
      const caixa = caixaAberto(db)!
      expect(caixa).toMatchObject({ operador: OPERADOR_AUTOMATICO, fundoTroco: 0 })
      expect(v.caixaId).toBe(caixa.id)
      vender(1, [['pix', 1000]])
      expect(listarCaixas(db)).toHaveLength(1)
      expect(caixaParaVender(db)!.vendas.quantidade).toBe(2)
    })

    it('depois de fechar à mão, a próxima venda abre outro caixa', () => {
      definirControleCaixa(db, false)
      const primeiro = caixaParaVender(db)!
      fecharCaixa(db, contagem({}), null)
      expect(vender(1, [['dinheiro', 1000]]).caixaId).not.toBe(primeiro.id)
    })

    it('religado, volta a exigir abertura', () => {
      definirControleCaixa(db, false)
      definirControleCaixa(db, true)
      expect(() => adicionarProduto(db, produtoId, 1000)).toThrow(/caixa está fechado/)
      expect(() => definirControleCaixa(db, 'nao')).toThrow(/inválida/)
    })
  })

  it('abre uma vez só e exige operador', () => {
    expect(() => abrirCaixa(db, '  ', 0)).toThrow(/operador/)
    const c = abrirCaixa(db, 'Maria', 10_000)
    expect(c).toMatchObject({ status: 'aberto', operador: 'Maria', fundoTroco: 10_000, dinheiroEsperado: 10_000 })
    expect(() => abrirCaixa(db, 'João', 0)).toThrow(/Já existe um caixa aberto/)
  })

  it('soma vendas por forma, desconta o troco e aplica sangria/suprimento', () => {
    abrirCaixa(db, 'Maria', 10_000) // R$ 100 de fundo
    vender(3, [['dinheiro', 5000]]) // R$ 30, troco R$ 20
    vender(2, [['pix', 1000], ['debito', 1000]])
    movimentarCaixa(db, 'suprimento', 5000, 'troco')
    const c = movimentarCaixa(db, 'sangria', 12_000, 'cofre')

    expect(c.vendas).toEqual({ quantidade: 2, total: 5000, canceladas: 0 })
    expect(c.recebido).toEqual({ dinheiro: 3000, debito: 1000, credito: 0, pix: 1000 })
    expect([c.suprimentos, c.sangrias]).toEqual([5000, 12_000])
    expect(c.dinheiroEsperado).toBe(10_000 + 3000 + 5000 - 12_000)
  })

  it('sangria não passa do dinheiro na gaveta', () => {
    abrirCaixa(db, 'Maria', 5000)
    expect(() => movimentarCaixa(db, 'sangria', 5001, null)).toThrow(/maior que o dinheiro/)
    expect(() => movimentarCaixa(db, 'sangria', 0, null)).toThrow(/Informe/)
  })

  it('fechamento cego grava esperado × contado e a diferença', () => {
    abrirCaixa(db, 'Maria', 10_000)
    vender(3, [['dinheiro', 3000]])
    vender(1, [['credito', 1000]])

    const fechado = fecharCaixa(db, contagem({ dinheiro: 12_950, credito: 1000 }), 'faltou 50 centavos')
    expect(fechado.status).toBe('fechado')
    expect(fechado.observacao).toBe('faltou 50 centavos')
    expect(fechado.fechamento).toEqual([
      { forma: 'dinheiro', esperado: 13_000, contado: 12_950, diferenca: -50 },
      { forma: 'debito', esperado: 0, contado: 0, diferenca: 0 },
      { forma: 'credito', esperado: 1000, contado: 1000, diferenca: 0 },
      { forma: 'pix', esperado: 0, contado: 0, diferenca: 0 }
    ])
    expect(caixaAberto(db)).toBeNull()
    expect(listarCaixas(db)[0]!.id).toBe(fechado.id)
  })

  it('exige todas as formas na contagem', () => {
    abrirCaixa(db, 'Maria', 0)
    expect(() => fecharCaixa(db, { dinheiro: 0 }, null)).toThrow(/Débito/)
  })

  it('não fecha com venda em andamento', () => {
    abrirCaixa(db, 'Maria', 0)
    adicionarProduto(db, produtoId, 1000)
    expect(() => fecharCaixa(db, contagem({}), null)).toThrow(/Finalize ou cancele a venda/)
  })

  it('venda de caixa já fechado não pode ser cancelada', () => {
    abrirCaixa(db, 'Maria', 0)
    const v = vender(1, [['dinheiro', 1000]])
    fecharCaixa(db, contagem({ dinheiro: 1000 }), null)
    abrirCaixa(db, 'João', 0)
    expect(() => cancelarVendaFinalizada(db, v.id)).toThrow(/caixa já fechado/)
  })

  it('venda cancelada conta no resumo e sai do total', () => {
    abrirCaixa(db, 'Maria', 0)
    const v = vender(1, [['dinheiro', 1000]])
    cancelarVendaFinalizada(db, v.id)
    expect(caixaAberto(db)!.vendas).toEqual({ quantidade: 0, total: 0, canceladas: 1 })
    expect(caixaAberto(db)!.dinheiroEsperado).toBe(0)
  })
})
