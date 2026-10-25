import type { ConfigBalancaSerial, LeituraBalanca } from '@shared/impressao'

const ENQ = 0x05

/**
 * Interpreta a resposta da balança no protocolo Toledo (Prix 3/4, também usado por
 * Filizola e Urano em modo compatível): STX + peso + ETX. O peso vem em gramas com 5 ou 6
 * dígitos ("00350" = 0,350 kg) ou em kg com separador ("0.350"). Letras repetidas indicam
 * estado: IIIII instável, NNNNN negativo, SSSSS sobrecarga.
 * Retorna null enquanto a resposta não chegou inteira.
 */
export function interpretarResposta(recebido: string): LeituraBalanca | null {
  const quadro = /\x02([^\x03]*)\x03/.exec(recebido)?.[1] ?? /^\s*([^\r\n\x02]+)[\r\n]/.exec(recebido)?.[1]
  if (quadro === undefined) return null
  const v = quadro.trim()
  if (/^I+$/.test(v)) return { ok: false, motivo: 'instavel' }
  if (/^N+$/.test(v)) return { ok: false, motivo: 'negativo' }
  if (/^S+$/.test(v)) return { ok: false, motivo: 'sobrecarga' }
  if (/^\d{5,6}$/.test(v)) return { ok: true, gramas: Number(v) }
  if (/^\d{1,3}[.,]\d{1,3}$/.test(v)) return { ok: true, gramas: Math.round(Number(v.replace(',', '.')) * 1000) }
  return { ok: false, motivo: 'invalida' }
}

/** O mínimo de uma porta serial que a leitura precisa (os testes usam uma falsa). */
export interface CanalSerial {
  escrever(bytes: Uint8Array): void
  aoReceber(cb: (texto: string) => void): void
  fechar(): void
}

/** Pede o peso (ENQ) e espera a resposta, no máximo `timeoutMs`. Sempre fecha a porta. */
export function lerPesoPor(canal: CanalSerial, timeoutMs = 1500): Promise<LeituraBalanca> {
  return new Promise((resolve) => {
    let recebido = ''
    let terminou = false
    const terminar = (r: LeituraBalanca): void => {
      if (terminou) return
      terminou = true
      clearTimeout(limite)
      canal.fechar()
      resolve(r)
    }
    const limite = setTimeout(() => terminar({ ok: false, motivo: 'sem-resposta' }), timeoutMs)
    canal.aoReceber((texto) => {
      recebido += texto
      const r = interpretarResposta(recebido)
      if (r) terminar(r)
    })
    canal.escrever(Uint8Array.of(ENQ))
  })
}

export type AbrirCanal = (cfg: ConfigBalancaSerial) => Promise<CanalSerial>

export async function lerPeso(cfg: ConfigBalancaSerial, abrir: AbrirCanal): Promise<LeituraBalanca> {
  if (cfg.modo !== 'serial' || !cfg.porta) return { ok: false, motivo: 'desligada' }
  return lerPesoPor(await abrir(cfg))
}
