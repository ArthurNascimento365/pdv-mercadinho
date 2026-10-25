import { describe, expect, it } from 'vitest'
import { crc16 } from '@shared/pix'
import { abrirBanco } from '../src/main/db/conexao'
import { comandoQr } from '../src/main/impressao/escpos'
import { salvarConfigImpressora, obterConfigImpressora, ServicoImpressao } from '../src/main/impressao/servico'
import type { Transportes } from '../src/main/impressao/transportes'
import { gerarPix, obterConfigPix, payloadPix, salvarConfigPix } from '../src/main/pix'

describe('Pix no PDV', () => {
  it('valida e normaliza a configuração', () => {
    const db = abrirBanco(':memory:')
    expect(() => salvarConfigPix(db, { chave: 'xyz', nome: 'Loja', cidade: 'SP' })).toThrow(/Chave Pix inválida/)
    expect(() => salvarConfigPix(db, { chave: '(11) 98765-4321', nome: '', cidade: 'SP' })).toThrow(/nome/)
    const cfg = salvarConfigPix(db, { chave: '(11) 98765-4321', nome: 'Mercadinho São José', cidade: 'São Paulo' })
    expect(cfg).toEqual({ chave: '+5511987654321', nome: 'Mercadinho Sao Jose', cidade: 'Sao Paulo' })
    expect(obterConfigPix(db)).toEqual(cfg)
    // Tudo em branco = desliga o Pix.
    expect(salvarConfigPix(db, { chave: '', nome: '', cidade: '' }).chave).toBe('')
  })

  it('gera payload com valor e txid da venda, e o SVG do QR', async () => {
    const db = abrirBanco(':memory:')
    expect(await gerarPix(db, 1000, 1)).toBeNull() // sem configuração
    salvarConfigPix(db, { chave: 'pix@loja.com', nome: 'Loja', cidade: 'Campinas' })
    const r = (await gerarPix(db, 2247, 42))!
    expect(r.payload).toContain('0112pix@loja.com')
    expect(r.payload).toContain('540522.47')
    expect(r.payload).toContain('0505PDV42')
    expect(r.payload.slice(-4)).toBe(crc16(r.payload.slice(0, -4)))
    expect(r.svg.startsWith('<svg')).toBe(true)
    expect(() => payloadPix(db, 0, null)).toThrow(/Valor/)
  })

  it('comando ESC/POS do QR: tamanho certo do bloco de dados', () => {
    const b = comandoQr('ABC')
    const i = b.findIndex((x, k) => x === 0x1d && b[k + 5] === 0x31 && b[k + 6] === 0x50)
    expect(b.slice(i, i + 11)).toEqual([0x1d, 0x28, 0x6b, 6, 0, 0x31, 0x50, 0x30, 0x41, 0x42, 0x43])
  })

  it('imprime o papel do Pix com o QR', async () => {
    const db = abrirBanco(':memory:')
    salvarConfigPix(db, { chave: 'pix@loja.com', nome: 'Loja', cidade: 'Campinas' })
    salvarConfigImpressora(db, { ...obterConfigImpressora(db), modo: 'rede', host: '10.0.0.5' })
    const envios: Uint8Array[] = []
    const t: Transportes = {
      windows: async () => undefined,
      serial: async () => undefined,
      driver: async () => undefined,
      rede: async (_h, _p, bytes) => {
        envios.push(bytes)
      }
    }
    await new ServicoImpressao(db, t).imprimirPix(1500, 7)
    const s = Buffer.from(envios[0]!).toString('latin1')
    expect(s).toContain('PAGUE COM PIX')
    expect(s).toContain('R$ 15,00')
    expect(s).toContain('\x1d(k') // comando de QR
    expect(s).toContain('br.gov.bcb.pix')
  })
})
