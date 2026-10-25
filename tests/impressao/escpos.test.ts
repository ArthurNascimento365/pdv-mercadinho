import { describe, expect, it } from 'vitest'
import { bytesSoGaveta, codificar, gerarEscPos } from '../../src/main/impressao/escpos'

const hex = (b: Iterable<number>) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ')

describe('codificar', () => {
  it('ASCII passa direto; espaço não separável vira espaço', () => {
    expect(codificar('R$ 1,00', 'cp850')).toEqual([...Buffer.from('R$ 1,00')])
  })

  it('acentos na CP850 e na CP860', () => {
    expect(hex(codificar('ãçÉ', 'cp850'))).toBe('c6 87 90')
    expect(hex(codificar('ãçÉ', 'cp860'))).toBe('84 87 90')
    expect(hex(codificar('Õõ', 'cp860'))).toBe('99 94')
    expect(hex(codificar('nº 1 · Maria', 'cp850'))).toContain('a7 20 31 20 fa')
  })

  it('sem tabela ou fora dela: tira o acento ou vira "?"', () => {
    expect(Buffer.from(codificar('Feijão Pão', 'sem')).toString()).toBe('Feijao Pao')
    expect(Buffer.from(codificar('ŕ€', 'cp850')).toString()).toBe('r?')
  })
})

describe('gerarEscPos', () => {
  const doc = {
    colunas: 10,
    linhas: [
      { texto: 'Leite', negrito: false, grande: false },
      { texto: 'TOTAL', negrito: true, grande: true }
    ]
  }

  it('inicializa, escolhe a tabela, formata e corta', () => {
    const b = hex(gerarEscPos(doc, { acentos: 'cp860', cortar: true }))
    expect(b.startsWith('1b 40 1b 74 03')).toBe(true) // ESC @, ESC t 3
    expect(b).toContain(`${hex(Buffer.from('Leite'))} 0a`)
    expect(b).toContain(`1b 45 01 1d 21 11 ${hex(Buffer.from('TOTAL'))} 0a 1d 21 00 1b 45 00`)
    expect(b.endsWith('1b 64 04 1d 56 42 00')).toBe(true)
  })

  it('sem corte e com gaveta antes do texto', () => {
    const b = hex(gerarEscPos(doc, { acentos: 'cp850', cortar: false }, { abrirGaveta: 'pino5' }))
    expect(b.startsWith('1b 40 1b 74 02 1b 70 01 19 fa')).toBe(true)
    expect(b.endsWith('1b 64 04')).toBe(true)
  })

  it('só gaveta', () => {
    expect(hex(bytesSoGaveta('pino2'))).toBe('1b 40 1b 70 00 19 fa')
  })
})
