import { describe, expect, it } from 'vitest'
import { decodificarArquivo, lerCsv } from '../../src/main/importacao/csv'

describe('lerCsv', () => {
  it('ponto e vírgula, com aspas e CRLF', () => {
    expect(lerCsv('a;b;c\r\n1;"x;y";"diz ""oi"""\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x;y', 'diz "oi"']
    ])
  })

  it('vírgula e quebra de linha dentro de aspas', () => {
    expect(lerCsv('a,b\n"linha\n2",3')).toEqual([
      ['a', 'b'],
      ['linha\n2', '3']
    ])
  })

  it('tab', () => {
    expect(lerCsv('a\tb\n1\t2\n')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })
})

describe('decodificarArquivo', () => {
  it('UTF-8 com BOM', () => {
    const bytes = new TextEncoder().encode('﻿descrição')
    expect(decodificarArquivo(bytes)).toBe('descrição')
  })

  it('Windows-1252 (Excel)', () => {
    // "Feijão" em Windows-1252: ã = 0xE3
    const bytes = Uint8Array.from([0x46, 0x65, 0x69, 0x6a, 0xe3, 0x6f])
    expect(decodificarArquivo(bytes)).toBe('Feijão')
  })
})
