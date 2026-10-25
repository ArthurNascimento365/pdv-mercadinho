import { beforeEach, describe, expect, it } from 'vitest'
import { abrirBanco, type Banco } from '../../src/main/db/conexao'
import { abrirCaixa } from '../../src/main/caixa/caixa'
import { movimentosDoProduto } from '../../src/main/repos/estoque'
import { atualizarProduto, contarNoMinimo, criarProduto, produtosNoMinimo } from '../../src/main/repos/produtos'
import { adicionarPagamento, adicionarProduto, cancelarVendaFinalizada, finalizarVenda } from '../../src/main/vendas/vendas'
import { entrada } from '../ajuda'

describe('estoque', () => {
  let db: Banco
  beforeEach(() => {
    db = abrirBanco(':memory:')
  })

  it('cadastro, ajuste, venda e cancelamento viram movimentos com saldo', () => {
    const p = criarProduto(db, entrada({ precoVenda: 500, estoqueAtual: 10_000 }))
    atualizarProduto(db, p.id, entrada({ precoVenda: 500, estoqueAtual: 12_000 }))
    abrirCaixa(db, 'Maria', 0)
    adicionarProduto(db, p.id, 3000)
    adicionarPagamento(db, 'dinheiro', 1500)
    const v = finalizarVenda(db)
    cancelarVendaFinalizada(db, v.id)

    expect(
      movimentosDoProduto(db, p.id)
        .reverse()
        .map((m) => [m.tipo, m.quantidade, m.saldo, m.vendaId])
    ).toEqual([
      ['inicial', 10_000, 10_000, null],
      ['ajuste', 2000, 12_000, null],
      ['venda', -3000, 9000, v.id],
      ['cancelamento_venda', 3000, 12_000, v.id]
    ])
  })

  it('salvar sem mudar o estoque não gera movimento', () => {
    const p = criarProduto(db, entrada({ estoqueAtual: 0 }))
    atualizarProduto(db, p.id, entrada({ descricao: 'Outro nome', estoqueAtual: 0 }))
    expect(movimentosDoProduto(db, p.id)).toEqual([])
  })

  it('lista quem chegou no mínimo, o mais crítico primeiro', () => {
    criarProduto(db, entrada({ descricao: 'Folgado', estoqueAtual: 10_000, estoqueMinimo: 3000 }))
    criarProduto(db, entrada({ descricao: 'No limite', estoqueAtual: 3000, estoqueMinimo: 3000 }))
    criarProduto(db, entrada({ descricao: 'Zerado', estoqueAtual: 0, estoqueMinimo: 2000 }))
    criarProduto(db, entrada({ descricao: 'Sem mínimo', estoqueAtual: 0, estoqueMinimo: 0 }))
    expect(produtosNoMinimo(db).map((p) => p.descricao)).toEqual(['Zerado', 'No limite'])
    expect(contarNoMinimo(db)).toBe(2)
  })
})
