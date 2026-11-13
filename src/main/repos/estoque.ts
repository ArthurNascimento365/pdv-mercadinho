import type { Milesimos } from '@shared/dinheiro'
import type { MovimentoEstoque, TipoMovimentoEstoque } from '@shared/estoque'
import type { Banco } from '../db/conexao'
import { ErroNegocio } from '../erros'
import { definirConfig, obterConfig } from './configuracoes'

/**
 * Controle de estoque (Configurações → Estoque, chave `estoque.controle`): ligado por padrão.
 * Desligado, as telas deixam de mostrar estoque, mínimo, lista de compras, validade e "sem giro",
 * mas vendas e entradas continuam movimentando o saldo por baixo (religar não perde o histórico).
 */
export function controleEstoqueLigado(db: Banco): boolean {
  return obterConfig(db, 'estoque.controle') !== 'desligado'
}

export function definirControleEstoque(db: Banco, ligado: unknown): void {
  if (typeof ligado !== 'boolean') throw new ErroNegocio('Opção de controle de estoque inválida')
  definirConfig(db, 'estoque.controle', ligado ? 'ligado' : 'desligado')
}

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
