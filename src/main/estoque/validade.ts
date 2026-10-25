import type { AlertasValidade, LoteEmEstoque } from '@shared/estoque'
import type { Unidade } from '@shared/produtos'
import { limparEspacos } from '@shared/texto'
import type { Banco } from '../db/conexao'
import { emTransacao } from '../db/transacao'
import { ErroNegocio, exigirId } from '../erros'
import { movimentarEstoque } from '../repos/estoque'
import { obterProduto } from '../repos/produtos'

const DIA_MS = 86_400_000

export function validarData(valor: unknown, campo = 'Validade'): string {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor) || Number.isNaN(Date.parse(`${valor}T00:00:00`))) {
    throw new ErroNegocio(`${campo} inválida`)
  }
  return valor
}

export function registrarLote(
  db: Banco,
  l: { produtoId: number; lote: string | null; validade: string; quantidade: number; entradaId?: number | null }
): void {
  db.prepare('INSERT INTO lotes (produto_id, lote, validade, quantidade, entrada_id) VALUES (?, ?, ?, ?, ?)').run(
    l.produtoId,
    l.lote,
    l.validade,
    l.quantidade,
    l.entradaId ?? null
  )
}

function diasAte(validade: string, hoje: Date): number {
  const meiaNoite = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime()
  return Math.round((new Date(`${validade}T00:00:00`).getTime() - meiaNoite) / DIA_MS)
}

/**
 * Lotes que ainda devem estar na prateleira. O caixa não escolhe lote (para não travar a
 * venda), então o relatório supõe FEFO: o estoque atual pertence aos lotes que vencem por
 * último. Ex.: entraram 10 (vence dia 5) e 10 (vence dia 20), estoque 12 → 10 do dia 20 e 2 do dia 5.
 */
export function lotesEmEstoque(db: Banco, hoje = new Date()): LoteEmEstoque[] {
  const linhas = db
    .prepare(
      `SELECT l.id, l.produto_id, p.descricao, p.unidade, p.estoque_atual, l.lote, l.validade, l.quantidade
       FROM lotes l JOIN produtos p ON p.id = l.produto_id
       WHERE p.ativo = 1 AND p.estoque_atual > 0
       ORDER BY l.produto_id, l.validade DESC, l.id DESC`
    )
    .all() as unknown as {
    id: number
    produto_id: number
    descricao: string
    unidade: Unidade
    estoque_atual: number
    lote: string | null
    validade: string
    quantidade: number
  }[]

  const resultado: LoteEmEstoque[] = []
  let produto = -1
  let restante = 0
  for (const l of linhas) {
    if (l.produto_id !== produto) {
      produto = l.produto_id
      restante = l.estoque_atual
    }
    const saldo = Math.min(restante, l.quantidade)
    restante -= saldo
    if (saldo > 0) {
      resultado.push({
        loteId: l.id,
        produtoId: l.produto_id,
        descricao: l.descricao,
        unidade: l.unidade,
        lote: l.lote,
        validade: l.validade,
        saldo,
        dias: diasAte(l.validade, hoje)
      })
    }
  }
  return resultado.sort((a, b) => (a.validade < b.validade ? -1 : a.validade > b.validade ? 1 : 0))
}

/** Painel da tela inicial: vencidos, vencendo em até 7 dias e em até 30 dias. */
export function alertasValidade(db: Banco, hoje = new Date()): AlertasValidade {
  const lotes = lotesEmEstoque(db, hoje)
  return {
    vencidos: lotes.filter((l) => l.dias < 0),
    em7: lotes.filter((l) => l.dias >= 0 && l.dias <= 7),
    em30: lotes.filter((l) => l.dias > 7 && l.dias <= 30)
  }
}

/** Entrada sem nota (compra no atacarejo, troca...): soma ao estoque e registra o lote. */
export function entradaManual(db: Banco, dado: unknown): void {
  const d = (dado ?? {}) as Record<string, unknown>
  emTransacao(db, () => {
    const produto = obterProduto(db, exigirId(d['produtoId']))
    if (!produto) throw new ErroNegocio('Produto não encontrado')
    const q = d['quantidade']
    if (typeof q !== 'number' || !Number.isSafeInteger(q) || q <= 0 || q > 9_999_000) throw new ErroNegocio('Quantidade inválida')
    if (produto.unidade === 'UN' && q % 1000 !== 0) throw new ErroNegocio('Produto vendido por unidade: quantidade inteira')
    const custo = d['custoUnitario']
    if (custo !== null && custo !== undefined && (typeof custo !== 'number' || !Number.isSafeInteger(custo) || custo < 0)) {
      throw new ErroNegocio('Custo inválido')
    }
    const validade = d['validade'] ? validarData(d['validade']) : null
    const lote = typeof d['lote'] === 'string' && d['lote'].trim() ? limparEspacos(d['lote']).slice(0, 40) : null

    movimentarEstoque(db, produto.id, q, 'entrada')
    if (typeof custo === 'number') {
      db.prepare(`UPDATE produtos SET preco_custo = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(
        custo,
        produto.id
      )
    }
    if (validade) registrarLote(db, { produtoId: produto.id, lote, validade, quantidade: q })
  })
}
