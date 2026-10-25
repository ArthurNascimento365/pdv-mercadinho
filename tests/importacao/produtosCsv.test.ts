import { beforeEach, describe, expect, it } from 'vitest'
import { abrirBanco, type Banco } from '../../src/main/db/conexao'
import { analisarCsvProdutos, importarCsvProdutos, MODELO_CSV } from '../../src/main/importacao/produtosCsv'
import { buscarProdutos, criarProduto, produtoPorEan } from '../../src/main/repos/produtos'
import { entrada } from '../ajuda'

const EAN = '7891000100103'

describe('importação CSV de produtos', () => {
  let db: Banco
  beforeEach(() => {
    db = abrirBanco(':memory:')
  })

  it('o modelo importa sem erros', () => {
    const a = analisarCsvProdutos(db, MODELO_CSV)
    expect(a.erros).toEqual([])
    expect(a.linhas).toHaveLength(2)
    expect(importarCsvProdutos(db, MODELO_CSV)).toEqual({ criados: 2, atualizados: 0 })
    expect(buscarProdutos(db, 'banana')[0]).toMatchObject({ unidade: 'KG', codigoBalanca: 12, precoVenda: 699 })
  })

  it('aceita cabeçalhos alternativos, preço com ponto e linha em branco', () => {
    const csv = 'Código de Barras,Nome,Preço,Qtd\n' + `${EAN},Leite,7.49,12\n\n,Pão de Forma,"8,90",3\n`
    const a = analisarCsvProdutos(db, csv)
    expect(a.erros).toEqual([])
    expect(a.totalLinhas).toBe(2)
    expect(a.linhas.map((l) => l.entrada)).toMatchObject([
      { ean: EAN, descricao: 'Leite', precoVenda: 749, estoqueAtual: 12_000, unidade: 'UN' },
      { ean: null, descricao: 'Pão de Forma', precoVenda: 890, estoqueAtual: 3_000 }
    ])
  })

  it('exige descrição e preço no cabeçalho', () => {
    const a = analisarCsvProdutos(db, 'ean;nome\n1;x\n')
    expect(a.erros).toEqual([{ linha: 1, mensagem: 'Faltam as colunas: preco_venda' }])
  })

  it('atualiza existente só nas colunas preenchidas e não mexe no estoque', () => {
    criarProduto(db, entrada({ ean: EAN, descricao: 'Leite', precoVenda: 500, estoqueAtual: 7_000 }))
    const csv = `ean;descricao;preco_venda;categoria;estoque\n${EAN};;6,50;;99\n`
    const a = analisarCsvProdutos(db, csv)
    expect(a.erros).toEqual([])
    expect(a.linhas[0]).toMatchObject({ acao: 'atualizar' })

    expect(importarCsvProdutos(db, csv)).toEqual({ criados: 0, atualizados: 1 })
    expect(produtoPorEan(db, EAN)).toMatchObject({
      descricao: 'Leite',
      precoVenda: 650,
      categoria: 'Mercearia',
      estoqueAtual: 7_000
    })
  })

  it('sem código, casa pela descrição para não duplicar ao reimportar', () => {
    const csv = 'descricao;preco_venda\nPão Francês;0,75\n'
    importarCsvProdutos(db, csv)
    expect(importarCsvProdutos(db, 'descricao;preco_venda\npao frances;0,80\n')).toEqual({ criados: 0, atualizados: 1 })
    expect(buscarProdutos(db, 'pao')).toHaveLength(1)
  })

  it('aponta os erros por linha e importa só as válidas', () => {
    const csv = [
      'ean;descricao;unidade;preco_venda',
      `${EAN};Leite;UN;7,49`,
      '7891000100104;Errado;UN;1,00',
      `${EAN};Repetido;UN;1,00`,
      ';Sem preço;UN;',
      ';Litro;LT;3,00',
      '7,89100E+12;Excel;UN;1,00'
    ].join('\n')
    const a = analisarCsvProdutos(db, csv)
    expect(a.linhas.map((l) => l.linha)).toEqual([2])
    expect(a.erros.map((e) => e.linha)).toEqual([3, 4, 5, 6, 7])
    expect(a.erros[1]!.mensagem).toMatch(/linha 2/)
    expect(a.erros[4]!.mensagem).toMatch(/notação científica/)
    expect(importarCsvProdutos(db, csv)).toEqual({ criados: 1, atualizados: 0 })
  })

  it('recusa código de balança que já é de outro produto', () => {
    criarProduto(db, entrada({ descricao: 'Banana', unidade: 'KG', codigoBalanca: 12 }))
    const a = analisarCsvProdutos(db, `ean;descricao;preco_venda;plu\n${EAN};Maçã;9,99;12\n`)
    expect(a.erros[0]?.mensagem).toMatch(/já é de "Banana"/)
  })
})
