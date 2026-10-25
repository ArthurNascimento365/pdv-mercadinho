import { describe, expect, it } from 'vitest'
import { interpretarResposta, lerPeso, lerPesoPor, type CanalSerial } from '../../src/main/impressao/balanca'

describe('interpretarResposta', () => {
  it.each([
    ['\x0200350\x03', { ok: true, gramas: 350 }],
    ['\x02012500\x03', { ok: true, gramas: 12500 }],
    ['\x02 0.350\x03', { ok: true, gramas: 350 }],
    ['\x021,250\x03', { ok: true, gramas: 1250 }],
    ['\x02IIIII\x03', { ok: false, motivo: 'instavel' }],
    ['\x02NNNNN\x03', { ok: false, motivo: 'negativo' }],
    ['\x02SSSSS\x03', { ok: false, motivo: 'sobrecarga' }],
    ['\x02xyz\x03', { ok: false, motivo: 'invalida' }],
    ['00480\r\n', { ok: true, gramas: 480 }]
  ])('%j', (recebido, esperado) => {
    expect(interpretarResposta(recebido)).toEqual(esperado)
  })

  it('resposta incompleta ainda não decide', () => {
    expect(interpretarResposta('\x02003')).toBeNull()
    expect(interpretarResposta('')).toBeNull()
  })
})

/** Balança falsa: responde ao ENQ em pedaços, como a serial faz. */
function balancaFalsa(resposta: string[] | null): CanalSerial & { escrito: number[]; fechada: boolean } {
  let cb: (t: string) => void = () => undefined
  const canal = {
    escrito: [] as number[],
    fechada: false,
    escrever(bytes: Uint8Array) {
      canal.escrito.push(...bytes)
      if (resposta) resposta.forEach((parte, i) => setTimeout(() => cb(parte), 5 * (i + 1)))
    },
    aoReceber(f: (t: string) => void) {
      cb = f
    },
    fechar() {
      canal.fechada = true
    }
  }
  return canal
}

describe('lerPesoPor', () => {
  it('manda ENQ, junta os pedaços e fecha a porta', async () => {
    const canal = balancaFalsa(['\x0200', '850\x03'])
    expect(await lerPesoPor(canal)).toEqual({ ok: true, gramas: 850 })
    expect(canal.escrito).toEqual([0x05])
    expect(canal.fechada).toBe(true)
  })

  it('sem resposta dentro do prazo', async () => {
    const canal = balancaFalsa(null)
    expect(await lerPesoPor(canal, 50)).toEqual({ ok: false, motivo: 'sem-resposta' })
    expect(canal.fechada).toBe(true)
  })

  it('não abre porta quando a leitura está desligada', async () => {
    let abriu = false
    const r = await lerPeso({ modo: 'nenhuma', porta: 'COM3', baud: 9600 }, async () => {
      abriu = true
      return balancaFalsa(null)
    })
    expect(r).toEqual({ ok: false, motivo: 'desligada' })
    expect(abriu).toBe(false)
  })
})
