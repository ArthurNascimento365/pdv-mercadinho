import { beforeEach, describe, expect, it } from 'vitest'
import { abrirBanco, type Banco } from '../../src/main/db/conexao'
import { confirmarEntrada } from '../../src/main/entradas/entradas'
import { lerNfe } from '../../src/main/entradas/nfe'
import { alertasValidade, entradaManual, lotesEmEstoque } from '../../src/main/estoque/validade'
import { criarProduto, obterProduto } from '../../src/main/repos/produtos'
import { entrada, XML_EXEMPLO } from '../ajuda'

/** Data local AAAA-MM-DD a `dias` de hoje. */
const daqui = (dias: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('validade', () => {
  let db: Banco
  let iogurte: number

  beforeEach(() => {
    db = abrirBanco(':memory:')
    iogurte = criarProduto(db, entrada({ descricao: 'Iogurte', estoqueAtual: 0, precoCusto: 200 })).id
  })

  it('entrada manual soma ao estoque, atualiza custo e registra o lote', () => {
    entradaManual(db, { produtoId: iogurte, quantidade: 12_000, custoUnitario: 250, validade: daqui(5), lote: 'A1' })
    expect(obterProduto(db, iogurte)).toMatchObject({ estoqueAtual: 12_000, precoCusto: 250 })
    expect(lotesEmEstoque(db)).toMatchObject([{ lote: 'A1', saldo: 12_000, dias: 5 }])
    expect(() => entradaManual(db, { produtoId: iogurte, quantidade: 1500 })).toThrow(/inteira/)
    expect(() => entradaManual(db, { produtoId: iogurte, quantidade: 1000, validade: '31/12/2026' })).toThrow(/Validade/)
  })

  it('FEFO: o estoque que sobrou é dos lotes que vencem por último', () => {
    entradaManual(db, { produtoId: iogurte, quantidade: 10_000, validade: daqui(3), lote: 'velho' })
    entradaManual(db, { produtoId: iogurte, quantidade: 10_000, validade: daqui(20), lote: 'novo' })
    db.prepare('UPDATE produtos SET estoque_atual = 12000 WHERE id = ?').run(iogurte) // vendeu 8
    expect(lotesEmEstoque(db).map((l) => [l.lote, l.saldo])).toEqual([
      ['velho', 2000],
      ['novo', 10_000]
    ])
  })

  it('alertas: vencidos, em até 7 dias e em até 30 dias; lote já vendido não alerta', () => {
    entradaManual(db, { produtoId: iogurte, quantidade: 1000, validade: daqui(-2), lote: 'vencido' })
    entradaManual(db, { produtoId: iogurte, quantidade: 1000, validade: daqui(7), lote: 'semana' })
    entradaManual(db, { produtoId: iogurte, quantidade: 1000, validade: daqui(25), lote: 'mes' })
    entradaManual(db, { produtoId: iogurte, quantidade: 1000, validade: daqui(90), lote: 'longe' })
    const a = alertasValidade(db)
    expect([a.vencidos, a.em7, a.em30].map((l) => l.map((x) => x.lote))).toEqual([['vencido'], ['semana'], ['mes']])

    db.prepare('UPDATE produtos SET estoque_atual = 3000 WHERE id = ?').run(iogurte) // o vencido "saiu" (FEFO)
    expect(alertasValidade(db).vencidos).toEqual([])
  })

  it('NF-e: lote/validade do <rastro> e validade digitada na conferência', () => {
    const nota = lerNfe(XML_EXEMPLO)
    const leite = criarProduto(db, entrada({ ean: '7891000100103', descricao: 'Leite', estoqueAtual: 0 })).id
    const acucar = criarProduto(db, entrada({ ean: '7891000100110', descricao: 'Açúcar', estoqueAtual: 0 })).id
    confirmarEntrada(db, nota, [
      { numero: 1, acao: 'vincular', produtoId: leite, fator: 24, precoVenda: null },
      { numero: 2, acao: 'vincular', produtoId: acucar, fator: 1, precoVenda: null, validade: '2027-06-30' },
      { numero: 3, acao: 'ignorar' }
    ])
    expect(lotesEmEstoque(db).map((l) => [l.descricao, l.lote, l.validade, l.saldo])).toEqual([
      ['Leite', 'L123', '2027-03-31', 48_000],
      ['Açúcar', null, '2027-06-30', 10_000]
    ])
  })
})
