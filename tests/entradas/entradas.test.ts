import { beforeEach, describe, expect, it } from 'vitest'
import type { DecisaoItem, NotaFiscal } from '@shared/estoque'
import type { Produto } from '@shared/produtos'
import { abrirBanco, type Banco } from '../../src/main/db/conexao'
import { confirmarEntrada, listarEntradas, sugerirVinculos } from '../../src/main/entradas/entradas'
import { lerNfe } from '../../src/main/entradas/nfe'
import { movimentosDoProduto } from '../../src/main/repos/estoque'
import { criarProduto, obterProduto } from '../../src/main/repos/produtos'
import { entrada, XML_EXEMPLO } from '../ajuda'

describe('entrada de mercadoria (NF-e)', () => {
  let db: Banco
  let nota: NotaFiscal
  let leite: Produto
  let acucar: Produto
  let queijo: Produto

  beforeEach(() => {
    db = abrirBanco(':memory:')
    nota = lerNfe(XML_EXEMPLO)
    leite = criarProduto(db, entrada({ ean: '7891000100103', descricao: 'Leite Condensado', precoVenda: 749, precoCusto: 500, estoqueAtual: 2000 }))
    acucar = criarProduto(db, entrada({ ean: '7891000100110', descricao: 'Açúcar', precoVenda: 549, estoqueAtual: 0 }))
    queijo = criarProduto(db, entrada({ descricao: 'Queijo Mussarela', unidade: 'KG', precoVenda: 4990, estoqueAtual: 0 }))
  })

  const decisoes = (extra: Partial<Record<number, Partial<DecisaoItem>>> = {}): DecisaoItem[] =>
    [
      { numero: 1, acao: 'vincular', produtoId: leite.id, fator: 24, precoVenda: 799 },
      { numero: 2, acao: 'vincular', produtoId: acucar.id, fator: 1, precoVenda: null },
      { numero: 3, acao: 'vincular', produtoId: queijo.id, fator: 1, precoVenda: null }
    ].map((d) => ({ ...d, ...extra[d.numero] }) as DecisaoItem)

  it('sugere pelo EAN da unidade (com fator da caixa) e pelo EAN', () => {
    const { fornecedorCadastrado, itens } = sugerirVinculos(db, nota)
    expect(fornecedorCadastrado).toBe(false)
    expect(itens.map((i) => [i.produto?.id ?? null, i.origem, i.fator])).toEqual([
      [leite.id, 'eanTributavel', 24],
      [acucar.id, 'ean', 1],
      [null, null, 1]
    ])
  })

  it('dá entrada: estoque, custo com impostos, preço novo, lote e histórico', () => {
    const r = confirmarEntrada(db, nota, decisoes())
    expect(r).toMatchObject({ fornecedor: 'Distribuidora Exemplo', numero: 1234, itens: 3, valorTotal: 39250 })

    const l = obterProduto(db, leite.id)!
    expect(l.estoqueAtual).toBe(50_000) // 2 + 48
    expect(l.precoCusto).toBe(516) // 247,50 / 48 = 5,15625
    expect(l.precoVenda).toBe(799)
    expect(l.precoAlteradoEm >= leite.precoAlteradoEm).toBe(true)

    const q = obterProduto(db, queijo.id)!
    expect(q.estoqueAtual).toBe(3250)
    expect(q.precoCusto).toBe(3200)
    expect(obterProduto(db, acucar.id)).toMatchObject({ estoqueAtual: 10_000, precoCusto: 410, precoVenda: 549 })

    expect(movimentosDoProduto(db, leite.id)[0]).toMatchObject({ tipo: 'entrada', quantidade: 48_000, saldo: 50_000 })
    const lote = db.prepare('SELECT lote, validade FROM entrada_itens WHERE produto_id = ?').get(leite.id)
    expect(lote).toEqual({ lote: 'L123', validade: '2027-03-31' })
  })

  it('aprende o vínculo: na próxima nota do fornecedor o item casa pelo código', () => {
    confirmarEntrada(db, nota, decisoes())
    const segunda = { ...nota, chave: nota.chave.replace(/5$/, '6') }
    const { fornecedorCadastrado, itens } = sugerirVinculos(db, segunda)
    expect(fornecedorCadastrado).toBe(true)
    expect(itens.map((i) => [i.produto?.id, i.origem, i.fator])).toEqual([
      [leite.id, 'vinculo', 24],
      [acucar.id, 'vinculo', 1],
      [queijo.id, 'vinculo', 1]
    ])
  })

  it('não deixa a mesma nota entrar duas vezes', () => {
    confirmarEntrada(db, nota, decisoes())
    expect(() => confirmarEntrada(db, nota, decisoes())).toThrow(/já entrou no estoque/)
    expect(listarEntradas(db)).toHaveLength(1)
  })

  it('item ignorado não entra', () => {
    confirmarEntrada(db, nota, decisoes({ 3: { acao: 'ignorar' } }))
    expect(obterProduto(db, queijo.id)!.estoqueAtual).toBe(0)
  })

  it('exige decisão para todo item', () => {
    expect(() => confirmarEntrada(db, nota, decisoes().slice(0, 2))).toThrow(/Item 3 .*escolha o produto/)
  })

  it('recusa fator que fraciona produto vendido por unidade, e nada é gravado', () => {
    expect(() => confirmarEntrada(db, nota, decisoes({ 1: { fator: 1.3 } }))).toThrow(/quantidade inteira/)
    expect(obterProduto(db, acucar.id)!.estoqueAtual).toBe(0)
    expect(listarEntradas(db)).toEqual([])
  })

  it('recusa nota toda ignorada', () => {
    const tudoIgnorado = nota.itens.map((i) => ({ numero: i.numero, acao: 'ignorar' as const }))
    expect(() => confirmarEntrada(db, nota, tudoIgnorado)).toThrow(/Nenhum item/)
  })
})
