import { createConnection } from 'node:net'
import { ErroNegocio } from '../erros'

/** Impressora de rede: abre TCP (geralmente porta 9100), manda os bytes e fecha. */
export function enviarRede(host: string, porta: number, bytes: Uint8Array, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port: porta })
    let falhou = false
    const falhar = (motivo: string): void => {
      falhou = true
      socket.destroy()
      reject(new ErroNegocio(`Impressora de rede ${host}:${porta} ${motivo}`))
    }
    socket.setTimeout(timeoutMs, () => falhar('não respondeu'))
    socket.once('error', (e: NodeJS.ErrnoException) =>
      falhar(e.code === 'ECONNREFUSED' ? 'recusou a conexão' : `deu erro (${e.code ?? e.message})`)
    )
    socket.once('connect', () => socket.end(Buffer.from(bytes)))
    socket.once('close', () => {
      if (!falhou) resolve()
    })
  })
}
