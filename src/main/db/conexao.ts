import { DatabaseSync } from 'node:sqlite'
import { executarMigracoes } from './migracoes'

export type Banco = DatabaseSync

/**
 * Abre (ou cria) o banco e aplica as migrações pendentes.
 * Use ':memory:' nos testes.
 */
export function abrirBanco(caminho: string): Banco {
  const db = new DatabaseSync(caminho, {
    enableForeignKeyConstraints: true,
    timeout: 5000
  })
  if (caminho !== ':memory:') {
    // WAL deixa a leitura (relatórios, backup) rodar enquanto o caixa grava.
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
  }
  executarMigracoes(db)
  return db
}
