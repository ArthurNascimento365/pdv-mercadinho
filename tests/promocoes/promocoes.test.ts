import { beforeEach, describe, expect, it } from 'vitest'
import { modulosEan, svgEan } from '@shared/codigoBarras'
import { hojeLocal, precoTabela, promocaoAtiva } from '@shared/precos'
import { abrirCaixa } from '../../src/main/caixa/caixa'
import { abrirBanco, type Banco } from '../../src/main/db/conexao'
import { htmlEtiquetas, marcarEtiquetasImpressas, produtosParaEtiqueta } from '../../src/main/promocoes/etiquetas'
import { atualizarProduto, criarProduto, obterProduto, produtoParaEntrada } from '../../src/main/repos/produtos'
import { adicionarProduto, cancelarItem, descontoItem, vendaAberta } from '../../src/main/vendas/vendas'
import { entrada } from '../ajuda'

const dia = (n: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return hojeLocal(d)
}

describe('código de barras EAN', () => {
  it('EAN-13 tem 95 módulos com guardas e paridade do 1º dígito', () => {
    // 4006381333931: 1º dígito 4 → paridade LGLLGG; o 2º dígito (0) em L = 0001101.
    const m = modulosEan('4006381333931')!
    expect(m).toHaveLength(95)
    expect(m.slice(0, 3)).toBe('101')
    expect(m.slice(3, 10)).toBe('0001101')
    expect(m.slice(45, 50)).toBe('01010')
    expect(m.slice(-3)).toBe('101')
  })

  it('EAN-8 (67), UPC-A vira EAN-13, inválido não desenha', () => {
    expect(modulosEan('96385074')).toHaveLength(67)
    expect(modulosEan('036000291452')).toBe(modulosEan('0036000291452'))
    expect(modulosEan('7891000100104')).toBeNull()
    expect(svgEan('17891000100100')).toBeNull() // DUN-14 é ITF, não EAN
    expect(svgEan('7891000100103')).toContain('<svg')
  })
})

describe('promoção e atacarejo', () => {
  let db: Banco

  beforeEach(() => {
    db = abrirBanco(':memory:')
    abrirCaixa(db, 'Maria', 0)
  })

  it('valida as regras no cadastro', () => {
    const base = entrada({ precoVenda: 1000 })
    expect(() => criarProduto(db, { ...base, precoPromocional: 1000, promocaoInicio: dia(0), promocaoFim: dia(1) })).toThrow(/menor/)
    expect(() => criarProduto(db, { ...base, precoPromocional: 800 })).toThrow(/início e o fim/)
    expect(() => criarProduto(db, { ...base, precoPromocional: 800, promocaoInicio: dia(2), promocaoFim: dia(1) })).toThrow(/antes do início/)
    expect(() => criarProduto(db, { ...base, atacadoQuantidade: 1000, atacadoPreco: 900 })).toThrow(/2 unidades/)
    expect(() => criarProduto(db, { ...base, atacadoQuantidade: 3000 })).toThrow(/Preço de atacado/)
  })

  it('promoção vale só dentro das datas', () => {
    const p = { precoVenda: 1000, precoPromocional: 799, promocaoInicio: '2026-10-10', promocaoFim: '2026-10-20', atacadoQuantidade: null, atacadoPreco: null }
    expect(promocaoAtiva(p, '2026-10-09')).toBe(false)
    expect(precoTabela(p, '2026-10-10')).toEqual({ preco: 799, tipo: 'promocao' })
    expect(precoTabela(p, '2026-10-20').preco).toBe(799)
    expect(precoTabela(p, '2026-10-21')).toEqual({ preco: 1000, tipo: 'normal' })
  })

  it('venda usa o preço promocional de hoje', () => {
    const p = criarProduto(db, entrada({ precoVenda: 1000, precoPromocional: 799, promocaoInicio: dia(-1), promocaoFim: dia(1) }))
    const v = adicionarProduto(db, p.id, 2000)
    expect(v.itens[0]).toMatchObject({ precoUnitario: 799, total: 1598, tipoPreco: 'promocao' })
  })

  it('atacarejo pela quantidade total do produto na venda, e volta se cancelar', () => {
    // Refrigerante R$ 9,00; a partir de 3 un, R$ 8,00.
    const p = criarProduto(db, entrada({ precoVenda: 900, atacadoQuantidade: 3000, atacadoPreco: 800 }))
    adicionarProduto(db, p.id, 1000)
    adicionarProduto(db, p.id, 1000)
    expect(vendaAberta(db)!.total).toBe(1800)
    const v = adicionarProduto(db, p.id, 1000) // 3ª unidade: todas passam para R$ 8,00
    expect(v.itens.map((i) => [i.precoUnitario, i.tipoPreco])).toEqual([
      [800, 'atacado'],
      [800, 'atacado'],
      [800, 'atacado']
    ])
    expect(v.total).toBe(2400)
    const depois = cancelarItem(db, v.itens[2]!.id)
    expect(depois.itens.slice(0, 2).map((i) => i.precoUnitario)).toEqual([900, 900])
    expect(depois.total).toBe(1800)
  })

  it('atacarejo mantém o desconto do item, limitado ao novo valor', () => {
    const p = criarProduto(db, entrada({ precoVenda: 900, atacadoQuantidade: 2000, atacadoPreco: 500 }))
    const v1 = adicionarProduto(db, p.id, 1000)
    descontoItem(db, v1.itens[0]!.id, 800)
    const v2 = adicionarProduto(db, p.id, 1000)
    expect(v2.itens.map((i) => [i.totalBruto, i.desconto, i.total])).toEqual([
      [500, 500, 0],
      [500, 0, 500]
    ])
  })

  it('promoção mais atacado: vale o menor', () => {
    const p = criarProduto(
      db,
      entrada({ precoVenda: 1000, precoPromocional: 700, promocaoInicio: dia(0), promocaoFim: dia(0), atacadoQuantidade: 2000, atacadoPreco: 750 })
    )
    const v = adicionarProduto(db, p.id, 2000)
    expect(v.itens[0]).toMatchObject({ precoUnitario: 700, tipoPreco: 'promocao' })
  })
})

describe('etiquetas de gôndola', () => {
  it('lista o que mudou desde a última impressão (preço ou promoção que começou)', async () => {
    const db = abrirBanco(':memory:')
    const arroz = criarProduto(db, entrada({ ean: '7891000100103', descricao: 'Arroz', precoVenda: 2000 }))
    criarProduto(db, entrada({ descricao: 'Feijão', precoVenda: 900, precoPromocional: 799, promocaoInicio: dia(0), promocaoFim: dia(3) }))
    marcarEtiquetasImpressas(db, new Date(Date.now() - 1000))
    // Os dois foram criados "agora"; força como se fossem antigos.
    db.prepare(`UPDATE produtos SET preco_alterado_em = '2020-01-01T00:00:00.000Z'`).run()
    await new Promise((r) => setTimeout(r, 5))
    atualizarProduto(db, arroz.id, { ...produtoParaEntrada(obterProduto(db, arroz.id)!), precoVenda: 2199 })

    const desde = new Date(Date.now() - 60_000).toISOString()
    expect(produtosParaEtiqueta(db, desde).map((p) => p.descricao)).toEqual(['Arroz', 'Feijão'])

    const html = htmlEtiquetas(produtosParaEtiqueta(db, desde))
    expect(html).toContain('R$ 21,99')
    expect(html).toContain('OFERTA até')
    expect(html).toContain('de R$ 9,00')
    expect(html).toContain('<svg') // código de barras do arroz
  })
})
