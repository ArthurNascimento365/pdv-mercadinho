import { describe, expect, it } from 'vitest'
import { formaValida, lerDesconto, lerEntradaCaixa } from '@shared/vendas'

describe('lerEntradaCaixa', () => {
  it.each([
    ['7891000100103', { codigo: '7891000100103', quantidade: null }],
    ['3*7891000100103', { codigo: '7891000100103', quantidade: 3000 }],
    [' 0,350 * 12 ', { codigo: '12', quantidade: 350 }]
  ])('%j', (texto, esperado) => {
    expect(lerEntradaCaixa(texto)).toEqual(esperado)
  })

  it.each(['', '*123', '0*123', 'x*123', '3*'])('rejeita %j', (texto) => {
    expect(lerEntradaCaixa(texto)).toBeNull()
  })
})

describe('lerDesconto', () => {
  it.each([
    ['2,50', 1000, 250],
    ['10%', 1000, 100],
    ['7,5%', 1999, 150], // 149,925
    ['100%', 749, 749],
    ['0', 749, 0]
  ])('%s sobre %i → %i', (texto, base, esperado) => {
    expect(lerDesconto(texto, base)).toBe(esperado)
  })

  it.each(['abc', '101%', '-1', '%'])('rejeita %j', (texto) => {
    expect(lerDesconto(texto, 1000)).toBeNull()
  })
})

it('formaValida', () => {
  expect(formaValida('pix')).toBe(true)
  expect(formaValida('toString')).toBe(false)
  expect(formaValida(1)).toBe(false)
})
