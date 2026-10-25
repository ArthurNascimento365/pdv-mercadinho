import { describe, expect, it } from 'vitest'
import {
  centavosParaTexto,
  formatarMoeda,
  lerMoeda,
  lerQuantidade,
  quantidadeParaTexto,
  totalItem
} from '@shared/dinheiro'

// Intl usa espaço não separável entre "R$" e o número.
const sem = (s: string) => s.replace(/ /g, ' ')

describe('formatarMoeda', () => {
  it('formata centavos em reais', () => {
    expect(sem(formatarMoeda(0))).toBe('R$ 0,00')
    expect(sem(formatarMoeda(399))).toBe('R$ 3,99')
    expect(sem(formatarMoeda(123456))).toBe('R$ 1.234,56')
  })
})

describe('lerMoeda', () => {
  it.each([
    ['12', 1200],
    ['12,5', 1250],
    ['12,50', 1250],
    ['0,05', 5],
    ['1.234,56', 123456],
    ['R$ 3,99', 399],
    ['-2,00', -200]
  ])('%s → %i', (texto, esperado) => {
    expect(lerMoeda(texto)).toBe(esperado)
  })

  it.each(['', 'abc', '12,345', '1.23,00', '12.5'])('rejeita %j', (texto) => {
    expect(lerMoeda(texto)).toBeNull()
  })
})

describe('centavosParaTexto', () => {
  it.each([
    [0, '0,00'],
    [5, '0,05'],
    [1250, '12,50'],
    [-200, '-2,00']
  ])('%i → %s', (c, t) => {
    expect(centavosParaTexto(c)).toBe(t)
    expect(lerMoeda(t)).toBe(c)
  })
})

describe('quantidades', () => {
  it.each([
    ['3', 3000],
    ['0,35', 350],
    ['1,250', 1250],
    ['2.5', 2500]
  ])('lê %s', (t, q) => {
    expect(lerQuantidade(t)).toBe(q)
  })

  it.each(['', 'x', '1,2345'])('rejeita %j', (t) => {
    expect(lerQuantidade(t)).toBeNull()
  })

  it('exibe conforme a unidade', () => {
    expect(quantidadeParaTexto(3000, 'UN')).toBe('3')
    expect(quantidadeParaTexto(1500, 'UN')).toBe('1,5')
    expect(quantidadeParaTexto(350, 'KG')).toBe('0,350')
    expect(quantidadeParaTexto(-2000, 'UN')).toBe('-2')
  })
})

describe('totalItem', () => {
  it('unidade inteira', () => {
    expect(totalItem(399, 3000)).toBe(1197)
  })

  it('produto pesado arredonda ao centavo', () => {
    // 0,357 kg a R$ 29,90/kg = 10,6743 → R$ 10,67
    expect(totalItem(2990, 357)).toBe(1067)
    // 0,250 kg a R$ 12,99/kg = 3,2475 → R$ 3,25
    expect(totalItem(1299, 250)).toBe(325)
  })
})
