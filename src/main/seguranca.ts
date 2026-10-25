import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Banco } from './db/conexao'
import { ErroNegocio } from './erros'
import { definirConfig, obterConfig } from './repos/configuracoes'

const CHAVE = 'gerente.senha'

function hash(senha: string, sal: Buffer): Buffer {
  return scryptSync(senha, sal, 32)
}

export function temSenhaGerente(db: Banco): boolean {
  return !!obterConfig(db, CHAVE)
}

/** Senha guardada só como scrypt + sal ("scrypt$salHex$hashHex"). */
export function conferirSenhaGerente(db: Banco, senha: unknown): boolean {
  const salvo = obterConfig(db, CHAVE)
  if (!salvo || typeof senha !== 'string' || senha.length === 0 || senha.length > 100) return false
  const [, salHex, hashHex] = salvo.split('$')
  if (!salHex || !hashHex) return false
  const esperado = Buffer.from(hashHex, 'hex')
  const calculado = hash(senha, Buffer.from(salHex, 'hex'))
  return esperado.length === calculado.length && timingSafeEqual(esperado, calculado)
}

export function definirSenhaGerente(db: Banco, nova: unknown, atual: unknown): void {
  if (temSenhaGerente(db) && !conferirSenhaGerente(db, atual)) throw new ErroNegocio('Senha atual do gerente incorreta')
  if (typeof nova !== 'string' || nova.length < 4 || nova.length > 100) {
    throw new ErroNegocio('A senha do gerente precisa ter pelo menos 4 caracteres')
  }
  const sal = randomBytes(16)
  definirConfig(db, CHAVE, `scrypt$${sal.toString('hex')}$${hash(nova, sal).toString('hex')}`)
}
