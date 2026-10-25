import { describe, expect, it } from 'vitest'
import { decimalParaInteiro, lerNfe } from '../../src/main/entradas/nfe'
import { XML_EXEMPLO } from '../ajuda'

describe('lerNfe', () => {
  const nota = lerNfe(XML_EXEMPLO)

  it('cabeçalho e emitente', () => {
    expect(nota).toMatchObject({
      chave: '35261012345678000195550010000012341000012345',
      numero: 1234,
      serie: 1,
      emissao: '2026-10-15T10:30:00-03:00',
      valorTotal: 39250,
      emitente: {
        cnpj: '12345678000195',
        razaoSocial: 'DISTRIBUIDORA EXEMPLO DE ALIMENTOS LTDA',
        nomeFantasia: 'Distribuidora Exemplo',
        telefone: '1133334444'
      }
    })
  })

  it('item em caixa com desconto, IPI, ICMS-ST e lote', () => {
    expect(nota.itens[0]).toEqual({
      numero: 1,
      codigo: '000123',
      ean: '17891000100100',
      eanTributavel: '7891000100103',
      descricao: 'LEITE CONDENSADO 395G CX C/24',
      unidade: 'CX',
      quantidade: 20000,
      unidadeTributavel: 'UN',
      quantidadeTributavel: 480000,
      custoTotal: 24750, // 240 − 10 + 5 + 12,50
      lotes: [{ lote: 'L123', validade: '2027-03-31' }]
    })
  })

  it('mantém zeros à esquerda e trata SEM GTIN', () => {
    expect(nota.itens[1]).toMatchObject({ codigo: '000456', ean: '7891000100110', custoTotal: 4100 })
    expect(nota.itens[2]).toMatchObject({
      codigo: 'ABC-77',
      ean: null,
      eanTributavel: null,
      descricao: 'QUEIJO MUSSARELA PECA KG',
      quantidade: 32500,
      lotes: []
    })
  })

  it('aceita a NF-e sem o envelope nfeProc', () => {
    const semProc = XML_EXEMPLO.replace(/^[\s\S]*?(<NFe[\s>])/, '$1').replace(/<protNFe[\s\S]*$/, '')
    expect(lerNfe(semProc).chave).toBe(nota.chave)
  })

  it.each([
    ['não é XML', 'isto não é xml <<<', /XML/],
    ['XML qualquer', '<?xml version="1.0"?><pedido><n>1</n></pedido>', /não é o XML de uma NF-e/],
    ['evento', '<procEventoNFe><evento/></procEventoNFe>', /evento/],
    ['sem chave', XML_EXEMPLO.replace('Id="NFe3526', 'Id="NFeX'), /chave/]
  ])('recusa %s', (_nome, xml, erro) => {
    expect(() => lerNfe(xml)).toThrow(erro)
  })
})

describe('decimalParaInteiro', () => {
  it.each([
    ['12', 2, 1200],
    ['12.3', 2, 1230],
    ['12.345', 2, 1235],
    ['12.344', 2, 1234],
    ['2.0000', 4, 20000],
    [null, 2, 0]
  ])('%s (%i casas) → %i', (v, casas, esperado) => {
    expect(decimalParaInteiro(v, casas)).toBe(esperado)
  })
})
