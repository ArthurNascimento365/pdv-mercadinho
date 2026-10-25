import { beforeEach, describe, expect, it } from 'vitest'
import { montarEtiquetaBalanca, type FormatoBalanca } from '@shared/balanca'
import { abrirBanco, type Banco } from '../../src/main/db/conexao'
import { criarProduto, definirAtivo } from '../../src/main/repos/produtos'
import { resolverCodigo } from '../../src/main/servicos/leitorCodigo'
import { entrada } from '../ajuda'

const EAN = '7891000100103'
const porPreco: FormatoBalanca = { digitosCodigo: 4, tipoValor: 'preco' }
const porPeso: FormatoBalanca = { digitosCodigo: 4, tipoValor: 'peso' }

describe('resolverCodigo', () => {
  let db: Banco
  beforeEach(() => {
    db = abrirBanco(':memory:')
    criarProduto(db, entrada({ ean: EAN, descricao: 'Leite Condensado' }))
    // Banana a R$ 6,99/kg
    criarProduto(db, entrada({ descricao: 'Banana', unidade: 'KG', precoVenda: 699, codigoBalanca: 12 }))
  })

  it('EAN cadastrado', () => {
    const r = resolverCodigo(db, EAN, porPreco)
    expect(r).toMatchObject({ origem: 'ean', quantidade: null, total: null, produto: { descricao: 'Leite Condensado' } })
  })

  it('etiqueta por preço: total da etiqueta, quantidade derivada', () => {
    const codigo = montarEtiquetaBalanca({ codigoProduto: 12, valor: 836 }, porPreco) // R$ 8,36
    const r = resolverCodigo(db, codigo, porPreco)
    expect(r).toMatchObject({ origem: 'balanca', total: 836, quantidade: 1196, produto: { descricao: 'Banana' } })
  })

  it('etiqueta por peso: total calculado', () => {
    const codigo = montarEtiquetaBalanca({ codigoProduto: 12, valor: 1250 }, porPeso) // 1,250 kg
    expect(resolverCodigo(db, codigo, porPeso)).toMatchObject({ quantidade: 1250, total: 874 }) // 8,7375
  })

  it('código da balança (PLU) digitado à mão', () => {
    expect(resolverCodigo(db, '12', porPreco)).toMatchObject({
      origem: 'plu',
      quantidade: null,
      total: null,
      produto: { descricao: 'Banana' }
    })
    expect(resolverCodigo(db, '13', porPreco)).toBeNull()
  })

  it('null para código desconhecido, produto inativo ou lixo', () => {
    expect(resolverCodigo(db, montarEtiquetaBalanca({ codigoProduto: 99, valor: 100 }, porPreco), porPreco)).toBeNull()
    expect(resolverCodigo(db, '7891000100110', porPreco)).toBeNull()
    expect(resolverCodigo(db, 'abc', porPreco)).toBeNull()

    const leite = resolverCodigo(db, EAN, porPreco)!.produto
    definirAtivo(db, leite.id, false)
    expect(resolverCodigo(db, EAN, porPreco)).toBeNull()
  })
})
