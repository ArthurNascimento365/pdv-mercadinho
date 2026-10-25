import { describe, expect, it } from 'vitest'
import { diagramar, quebrar } from '../../src/main/impressao/diagramar'

describe('quebrar', () => {
  it('quebra por palavra e corta palavra longa', () => {
    expect(quebrar('LEITE CONDENSADO INTEGRAL 395G', 12)).toEqual(['LEITE', 'CONDENSADO', 'INTEGRAL', '395G'])
    expect(quebrar('ab cd ef', 5)).toEqual(['ab cd', 'ef'])
    expect(quebrar('ABCDEFGHIJ', 4)).toEqual(['ABCD', 'EFGH', 'IJ'])
    expect(quebrar('', 10)).toEqual([''])
  })
})

describe('diagramar', () => {
  const linhas = (doc: Parameters<typeof diagramar>[0], colunas = 20) => diagramar(doc, colunas).linhas.map((l) => l.texto)

  it('alinha texto e preenche a largura', () => {
    expect(linhas([{ tipo: 'texto', texto: 'oi', alinhamento: 'centro' }], 10)).toEqual(['    oi    '])
    expect(linhas([{ tipo: 'texto', texto: 'oi', alinhamento: 'direita' }], 6)).toEqual(['    oi'])
  })

  it('colunas: valor encostado à direita; descrição longa quebra', () => {
    expect(linhas([{ tipo: 'colunas', esquerda: 'TOTAL', direita: '45,62' }])).toEqual(['TOTAL          45,62'])
    expect(linhas([{ tipo: 'colunas', esquerda: 'LEITE CONDENSADO INTEGRAL', direita: '22,47' }])).toEqual([
      'LEITE CONDENSADO    ',
      'INTEGRAL       22,47'
    ])
  })

  it('mantém o recuo do detalhe do item, inclusive ao quebrar', () => {
    expect(linhas([{ tipo: 'colunas', esquerda: '    3 un x 7,49', direita: '22,47' }], 24)).toEqual([
      '    3 un x 7,49    22,47'
    ])
    expect(linhas([{ tipo: 'colunas', esquerda: '    LEITE CONDENSADO INTEGRAL', direita: '22,47' }])).toEqual([
      '    LEITE CONDENSADO',
      '    INTEGRAL   22,47'
    ])
  })

  it('texto grande usa metade das colunas', () => {
    const d = diagramar([{ tipo: 'colunas', esquerda: 'TOTAL', direita: 'R$ 9,99', grande: true }], 32)
    expect(d.linhas).toEqual([{ texto: 'TOTAL    R$ 9,99', negrito: false, grande: true }])
  })

  it('separador e espaço ocupam a linha toda', () => {
    expect(linhas([{ tipo: 'separador' }, { tipo: 'espaco' }], 5)).toEqual(['-----', '     '])
  })
})
