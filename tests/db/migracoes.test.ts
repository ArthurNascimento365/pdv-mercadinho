import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { abrirBanco } from '../../src/main/db/conexao'
import { executarMigracoes, MIGRACOES, versaoAtual, type Migracao } from '../../src/main/db/migracoes'

describe('migrações', () => {
  const pastas: string[] = []
  afterEach(() => {
    for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true })
  })

  it('banco novo sai na última versão', () => {
    const db = abrirBanco(':memory:')
    expect(versaoAtual(db)).toBe(MIGRACOES.length)
  })

  it('é idempotente: reabrir não reaplica nada', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'pdv-'))
    pastas.push(pasta)
    const caminho = join(pasta, 'pdv.db')

    abrirBanco(caminho).close()
    const db = abrirBanco(caminho)
    expect(versaoAtual(db)).toBe(MIGRACOES.length)
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    db.close()
  })

  it('migração com erro não deixa nada pela metade', () => {
    const db = new DatabaseSync(':memory:')
    const migracoes: Migracao[] = [
      { versao: 1, nome: 'ok', sql: 'CREATE TABLE a (x INTEGER);' },
      { versao: 2, nome: 'quebra', sql: 'CREATE TABLE b (x INTEGER); INSERT INTO nao_existe VALUES (1);' }
    ]
    expect(() => executarMigracoes(db, migracoes)).toThrow()
    expect(versaoAtual(db)).toBe(1)
    const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
    expect(tabelas).toEqual([{ name: 'a' }])
  })

  it('recusa banco mais novo que o programa', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`PRAGMA user_version = ${MIGRACOES.length + 1}`)
    expect(() => executarMigracoes(db)).toThrow(/Atualize o PDV/)
  })

  it('recusa lista fora de sequência', () => {
    const db = new DatabaseSync(':memory:')
    expect(() => executarMigracoes(db, [{ versao: 2, nome: 'x', sql: '' }])).toThrow(/fora de sequência/)
  })

  it('chaves estrangeiras estão ligadas', () => {
    const db = abrirBanco(':memory:')
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
  })
})
