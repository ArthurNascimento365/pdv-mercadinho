import type { DatabaseSync } from 'node:sqlite'
import { emTransacao } from './transacao'
import { m001Inicial } from './migracoes/001_inicial'
import { m002Produtos } from './migracoes/002_produtos'
import { m003Vendas } from './migracoes/003_vendas'
import { m004CaixaEstoqueEntradas } from './migracoes/004_caixa_estoque_entradas'
import { m005Fiado } from './migracoes/005_fiado'
import { m006CustosLotes } from './migracoes/006_custos_lotes'
import { m007Promocoes } from './migracoes/007_promocoes'

export interface Migracao {
  versao: number
  nome: string
  sql: string
}

/** Lista ordenada. Nunca edite uma migração já distribuída: crie a próxima. */
export const MIGRACOES: readonly Migracao[] = [m001Inicial, m002Produtos, m003Vendas, m004CaixaEstoqueEntradas, m005Fiado, m006CustosLotes, m007Promocoes]

export function versaoAtual(db: DatabaseSync): number {
  const linha = db.prepare('PRAGMA user_version').get() as { user_version: number }
  return linha.user_version
}

/** Aplica as migrações pendentes, cada uma em sua transação. Retorna a versão final. */
export function executarMigracoes(db: DatabaseSync, migracoes: readonly Migracao[] = MIGRACOES): number {
  migracoes.forEach((m, i) => {
    if (m.versao !== i + 1) {
      throw new Error(`Migração fora de sequência: esperado ${i + 1}, recebido ${m.versao} (${m.nome})`)
    }
  })

  const atual = versaoAtual(db)
  if (atual > migracoes.length) {
    throw new Error(
      `O banco está na versão ${atual}, mais nova que este programa (${migracoes.length}). Atualize o PDV.`
    )
  }

  for (const m of migracoes.slice(atual)) {
    emTransacao(db, () => {
      db.exec(m.sql)
      db.exec(`PRAGMA user_version = ${m.versao}`)
    })
  }
  return versaoAtual(db)
}
