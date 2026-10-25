import { describe, expect, it } from 'vitest'
import { cnpjValido, cpfValido, crc16, gerarBrCode, normalizarChavePix, textoBrCode } from '@shared/pix'

describe('BR Code', () => {
  it('reproduz o exemplo do manual do Banco Central (chave aleatória, sem valor)', () => {
    expect(
      gerarBrCode({
        chave: '123e4567-e12b-12d1-a456-426655440000',
        nome: 'Fulano de Tal',
        cidade: 'BRASILIA',
        valor: null
      })
    ).toBe(
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D'
    )
  })

  it('com valor, txid e texto com acento', () => {
    const p = gerarBrCode({
      chave: 'pix@mercadinho.com',
      nome: 'Mercadinho São José da Esquina',
      cidade: 'São Paulo',
      valor: 2247,
      txid: 'PDV-123'
    })
    expect(p).toContain('540522.47')
    expect(p).toContain('5925Mercadinho Sao Jose da E')
    expect(p).toContain('6009Sao Paulo')
    expect(p).toContain('62100506PDV123')
    // CRC confere com o resto do payload.
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)))
  })

  it('crc16 CCITT-FALSE', () => {
    expect(crc16('123456789')).toBe('29B1')
  })

  it('texto sem acento e limitado', () => {
    expect(textoBrCode('  Açaí  do   Zé ', 10)).toBe('Acai do Ze')
  })
})

describe('chave Pix', () => {
  it.each([
    ['529.982.247-25', { tipo: 'cpf', chave: '52998224725' }],
    ['11.222.333/0001-81', { tipo: 'cnpj', chave: '11222333000181' }],
    ['(11) 98765-4321', { tipo: 'telefone', chave: '+5511987654321' }],
    ['+55 11 98765-4321', { tipo: 'telefone', chave: '+5511987654321' }],
    ['Loja@Mercadinho.COM', { tipo: 'email', chave: 'loja@mercadinho.com' }],
    ['123E4567-E12B-12D1-A456-426655440000', { tipo: 'aleatoria', chave: '123e4567-e12b-12d1-a456-426655440000' }]
  ])('%s', (entrada, esperado) => {
    expect(normalizarChavePix(entrada)).toEqual(esperado)
  })

  it.each(['', 'abc', '123', '111.111.111-11x@'])('recusa %j', (entrada) => {
    expect(normalizarChavePix(entrada)).toBeNull()
  })

  it('dígitos verificadores', () => {
    expect(cpfValido('52998224725')).toBe(true)
    expect(cpfValido('52998224724')).toBe(false)
    expect(cpfValido('11111111111')).toBe(false)
    expect(cnpjValido('11222333000181')).toBe(true)
    expect(cnpjValido('11222333000180')).toBe(false)
  })
})
