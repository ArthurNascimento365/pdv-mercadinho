import type { Milesimos } from '@shared/dinheiro'
import type { MovimentoEstoque, TipoMovimentoEstoque } from '@shared/estoque'
import type { Banco } from '../db/conexao'

/**
 * Única porta de mudança de estoque: atualiza o saldo e registra o movimento.
 * Chame dentro da transação da operação que causou o movimento.
 */
export function movimentarEstoque(
  db: Banco,
  produtoId: number,
  quantidade: Milesimos,
  tipo: TipoMovimentoEstoque,
  origem: { vendaId?: number; entradaId?: number } = {}
): void {
  if (quantidade === 0) return
  db.prepare('UPDATE produtos SET estoque_atual = estoque_atual + ? WHERE id = ?').run(quantidade, produtoId)
  db.prepare(
    `INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, saldo, venda_id, entrada_id)
     VALUES (?, ?, ?, (SELECT estoque_atual FROM produtos WHERE id = ?), ?, ?)`
  ).run(produtoId, tipo, quantidade, produtoId, origem.vendaId ?? null, origem.entradaId ?? null)
}

export function movimentosDoProduto(db: Banco, produtoId: number, limite = 100): MovimentoEstoque[] {
  return db
    .prepare(
      `SELECT id, tipo, quantidade, saldo, venda_id AS vendaId, entrada_id AS entradaId, criado_em AS criadoEm
       FROM movimentos_estoque WHERE produto_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(produtoId, limite) as unknown as MovimentoEstoque[]
}
