import { describe, expect, it } from 'vitest'
import { lerEtiquetaBalanca, montarEtiquetaBalanca, type FormatoBalanca } from '@shared/balanca'
import { comDv } from '../ajuda'

const preco4: FormatoBalanca = { digitosCodigo: 4, tipoValor: 'preco' }
const peso6: FormatoBalanca = { digitosCodigo: 6, tipoValor: 'peso' }

describe('etiqueta de balança', () => {
  it('lê código de 4 dígitos e valor de 7', () => {
    // 2 | 0012 | 0001067 | DV  → produto 12, R$ 10,67
    expect(lerEtiquetaBalanca(comDv('200120001067'), preco4)).toEqual({ codigoProduto: 12, valor: 1067 })
  })

  it('lê código de 6 dígitos e valor de 5', () => {
    // 2 | 000345 | 00350 | DV  → produto 345, 350 g
    expect(lerEtiquetaBalanca(comDv('200034500350'), peso6)).toEqual({ codigoProduto: 345, valor: 350 })
  })

  it('rejeita o que não é etiqueta', () => {
    expect(lerEtiquetaBalanca('7891000100103', preco4)).toBeNull() // não começa com 2
    expect(lerEtiquetaBalanca('2001200010670', preco4)).toBeNull() // DV errado
    expect(lerEtiquetaBalanca('20012000106', preco4)).toBeNull() // curto
  })

  it('monta e lê de volta', () => {
    for (const formato of [preco4, peso6, { digitosCodigo: 5, tipoValor: 'preco' } as const]) {
      const codigo = montarEtiquetaBalanca({ codigoProduto: 77, valor: 4321 }, formato)
      expect(codigo).toHaveLength(13)
      expect(lerEtiquetaBalanca(codigo, formato)).toEqual({ codigoProduto: 77, valor: 4321 })
    }
  })

  it('recusa valor que não cabe', () => {
    expect(() => montarEtiquetaBalanca({ codigoProduto: 1, valor: 123456 }, peso6)).toThrow()
  })
})
