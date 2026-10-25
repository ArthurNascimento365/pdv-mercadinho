import { beforeEach, describe, expect, it } from 'vitest'
import { periodoPadrao } from '@shared/relatorios'
import { abrirCaixa, fecharCaixa } from '../../src/main/caixa/caixa'
import { abrirBanco, type Banco } from '../../src/main/db/conexao'
import { criarCliente } from '../../src/main/fiado/fiado'
import {
  curvaAbc,
  intervalo,
  produtosSemGiro,
  relatorioFechamentos,
  relatorioFiado,
  relatorioMargem,
  relatorioVendas
} from '../../src/main/relatorios/relatorios'
import { criarProduto } from '../../src/main/repos/produtos'
import {
  adicionarPagamento,
  adicionarProduto,
  cancelarVendaFinalizada,
  definirClienteVenda,
  descontoVenda,
  finalizarVenda
} from '../../src/main/vendas/vendas'
import { entrada } from '../ajuda'

describe('relatórios', () => {
  let db: Banco
  let arroz: number // venda 20,00 custo 15,00
  let cafe: number // venda 10,00 custo 6,00
  let bala: number // venda 1,00 sem custo
  const hoje = periodoPadrao('hoje')

  beforeEach(() => {
    db = abrirBanco(':memory:')
    abrirCaixa(db, 'Maria', 0)
    arroz = criarProduto(db, entrada({ descricao: 'Arroz', precoVenda: 2000, precoCusto: 1500, categoria: 'Mercearia', estoqueAtual: 100_000 })).id
    cafe = criarProduto(db, entrada({ descricao: 'Café', precoVenda: 1000, precoCusto: 600, categoria: 'Mercearia', estoqueAtual: 100_000 })).id
    bala = criarProduto(db, entrada({ descricao: 'Bala', precoVenda: 100, precoCusto: null, categoria: 'Doces', estoqueAtual: 100_000 })).id
  })

  function vender(itens: [number, number][], pagamentos: [Parameters<typeof adicionarPagamento>[1], number][], desconto = 0) {
    for (const [id, un] of itens) adicionarProduto(db, id, un * 1000)
    if (desconto) descontoVenda(db, desconto)
    for (const [f, v] of pagamentos) adicionarPagamento(db, f, v)
    return finalizarVenda(db)
  }

  it('período: datas locais viram intervalo UTC; recusa período invertido', () => {
    const [ini, fim] = intervalo({ de: '2026-10-01', ate: '2026-10-01' })
    expect(new Date(ini).getDate()).toBe(1)
    expect(new Date(fim).getTime() - new Date(ini).getTime()).toBe(86_400_000 - 1)
    expect(() => intervalo({ de: '2026-10-02', ate: '2026-10-01' })).toThrow(/depois/)
    expect(() => intervalo({ de: 'ontem', ate: '2026-10-01' })).toThrow(/inválido/)
  })

  it('vendas: totais, ticket médio, descontos e formas (dinheiro sem o troco)', () => {
    vender([[arroz, 1]], [['dinheiro', 5000]]) // 20,00, troco 30
    vender([[cafe, 2]], [['pix', 1500], ['debito', 400]], 100) // 20,00 − 1,00
    const v = vender([[bala, 3]], [['dinheiro', 300]])
    cancelarVendaFinalizada(db, v.id)

    const r = relatorioVendas(db, hoje)
    expect(r).toMatchObject({ quantidade: 2, canceladas: 1, faturamento: 3900, descontos: 100, ticketMedio: 1950 })
    expect(r.porForma).toEqual([
      { forma: 'dinheiro', valor: 2000 },
      { forma: 'pix', valor: 1500 },
      { forma: 'debito', valor: 400 }
    ])
    expect(r.porDia).toEqual([{ dia: hoje.de, quantidade: 2, total: 3900 }])
  })

  it('margem por produto e categoria, com o desconto da venda rateado', () => {
    vender([[arroz, 1], [cafe, 1]], [['dinheiro', 2700]], 300) // 30,00 − 3,00 (10%)
    vender([[bala, 5]], [['dinheiro', 500]])
    const m = relatorioMargem(db, hoje)
    const p = Object.fromEntries(m.produtos.map((l) => [l.descricao, l]))
    expect(p['Arroz']).toMatchObject({ receita: 1800, custo: 1500, lucro: 300, margem: 16.7 })
    expect(p['Café']).toMatchObject({ receita: 900, custo: 600, lucro: 300, margem: 33.3 })
    expect(p['Bala']).toMatchObject({ receita: 500, custo: 0, semCusto: true })
    expect(m.categorias.find((c) => c.descricao === 'Mercearia')).toMatchObject({ receita: 2700, custo: 2100, lucro: 600 })
    expect(m.total).toMatchObject({ receita: 3200, custo: 2100, semCusto: true })
  })

  it('usa o custo do momento da venda, não o atual', () => {
    vender([[cafe, 1]], [['dinheiro', 1000]])
    db.prepare('UPDATE produtos SET preco_custo = 900 WHERE id = ?').run(cafe)
    expect(relatorioMargem(db, hoje).produtos[0]).toMatchObject({ custo: 600 })
  })

  it('curva ABC', () => {
    vender([[arroz, 8]], [['dinheiro', 16_000]]) // 160 → 80%
    vender([[cafe, 3]], [['dinheiro', 3000]]) // 30 → 95%
    vender([[bala, 10]], [['dinheiro', 1000]]) // 10 → 100%
    expect(curvaAbc(db, hoje).map((l) => [l.descricao, l.classe, l.participacao, l.acumulado])).toEqual([
      ['Arroz', 'A', 80, 80],
      ['Café', 'B', 15, 95],
      ['Bala', 'C', 5, 100]
    ])
  })

  it('fechamentos de caixa no período', () => {
    vender([[arroz, 1]], [['dinheiro', 2000]])
    fecharCaixa(db, { dinheiro: 1950, debito: 0, credito: 0, pix: 0 }, null)
    expect(relatorioFechamentos(db, hoje)).toEqual([
      expect.objectContaining({ operador: 'Maria', vendido: 2000, esperado: 2000, contado: 1950, diferenca: -50 })
    ])
  })

  it('fiado em aberto e inadimplência', () => {
    const c = criarCliente(db, { nome: 'Zé', telefone: null, limite: 10_000 }).id
    adicionarProduto(db, arroz, 1000)
    definirClienteVenda(db, c)
    adicionarPagamento(db, 'fiado', 2000)
    finalizarVenda(db)
    db.prepare(`UPDATE fiado_lancamentos SET criado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 days')`).run()
    expect(relatorioFiado(db)).toMatchObject({ totalAReceber: 2000, totalAtrasado: 2000, clientes: [{ nome: 'Zé', atrasado: true }] })
  })

  it('sem giro: com estoque e sem venda há mais de 30 dias', () => {
    vender([[cafe, 1]], [['dinheiro', 1000]])
    // Todos cadastrados há 60 dias; o café vendeu hoje.
    db.prepare(`UPDATE produtos SET criado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 days')`).run()
    const r = produtosSemGiro(db, 30)
    expect(r.map((l) => l.descricao)).toEqual(['Arroz', 'Bala'])
    expect(r[0]).toMatchObject({ valorParado: 150_000, ultimaVenda: null })
  })
})
