import type { DatabaseSync } from 'node:sqlite'

let contadorSavepoint = 0

/**
 * Executa `fn` dentro de uma transação. Faz ROLLBACK se `fn` lançar.
 * Transações aninhadas viram SAVEPOINTs, então repositórios podem chamar uns aos outros.
 */
export function emTransacao<T>(db: DatabaseSync, fn: () => T): T {
  if (!db.isTransaction) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const resultado = fn()
      db.exec('COMMIT')
      return resultado
    } catch (erro) {
      db.exec('ROLLBACK')
      throw erro
    }
  }

  const savepoint = `sp_${++contadorSavepoint}`
  db.exec(`SAVEPOINT ${savepoint}`)
  try {
    const resultado = fn()
    db.exec(`RELEASE ${savepoint}`)
    return resultado
  } catch (erro) {
    db.exec(`ROLLBACK TO ${savepoint}`)
    db.exec(`RELEASE ${savepoint}`)
    throw erro
  }
}
