import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { emTransacao } from '../../src/main/db/transacao'

describe('emTransacao', () => {
  let db: DatabaseSync
  const contar = () => (db.prepare('SELECT count(*) AS n FROM t').get() as { n: number }).n

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE t (x INTEGER)')
  })

  it('confirma quando dá certo e devolve o resultado', () => {
    const r = emTransacao(db, () => {
      db.exec('INSERT INTO t VALUES (1)')
      return 42
    })
    expect(r).toBe(42)
    expect(contar()).toBe(1)
    expect(db.isTransaction).toBe(false)
  })

  it('desfaz tudo quando lança', () => {
    expect(() =>
      emTransacao(db, () => {
        db.exec('INSERT INTO t VALUES (1)')
        throw new Error('falhou')
      })
    ).toThrow('falhou')
    expect(contar()).toBe(0)
    expect(db.isTransaction).toBe(false)
  })

  it('aninhada desfaz só o trecho interno', () => {
    emTransacao(db, () => {
      db.exec('INSERT INTO t VALUES (1)')
      try {
        emTransacao(db, () => {
          db.exec('INSERT INTO t VALUES (2)')
          throw new Error('interno')
        })
      } catch {
        // esperado
      }
      db.exec('INSERT INTO t VALUES (3)')
    })
    expect(db.prepare('SELECT x FROM t ORDER BY x').all()).toEqual([{ x: 1 }, { x: 3 }])
  })
})
