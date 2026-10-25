import { describe, expect, it } from 'vitest'
import { digitoVerificador, eanValido, limparCodigo } from '@shared/ean'

describe('EAN', () => {
  it('calcula o dígito verificador', () => {
    expect(digitoVerificador('789100010010')).toBe(3)
    expect(digitoVerificador('9638507')).toBe(4) // EAN-8 96385074
  })

  it.each(['7891000100103', '96385074', '036000291452', '17891000100100'])('aceita %s', (c) => {
    expect(eanValido(c)).toBe(true)
  })

  it.each(['7891000100104', '123', '78910001001a3', '', '789100010010333'])('rejeita %j', (c) => {
    expect(eanValido(c)).toBe(false)
  })

  it('limpa espaços e pontuação', () => {
    expect(limparCodigo(' 7891 000-100.103 ')).toBe('7891000100103')
  })
})
