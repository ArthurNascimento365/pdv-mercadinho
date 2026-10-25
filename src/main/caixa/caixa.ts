import type { Contagem, LinhaFechamento, MovimentoCaixa, ResumoCaixa } from '@shared/caixa'
import { formatarMoeda, type Centavos } from '@shared/dinheiro'
import { limparEspacos } from '@shared/texto'
import { FORMAS_CONTAVEIS, FORMAS_PAGAMENTO, type FormaContavel, type FormaPagamento } from '@shared/vendas'
import type { Banco } from '../db/conexao'
import { emTransacao } from '../db/transacao'
import { ErroNegocio, exigirId } from '../erros'
import { definirConfig, obterConfig } from '../repos/configuracoes'

const AGORA = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
const VALOR_MAXIMO = 10_000_000 // R$ 100.000,00
const FORMAS = FORMAS_CONTAVEIS

interface LinhaCaixa {
  id: number
  status: 'aberto' | 'fechado'
  operador: string
  fundo_troco: number
  aberto_em: string
  fechado_em: string | null
  observacao: string | null
}

function exigirValor(valor: unknown, campo: string, { permitirZero = false } = {}): Centavos {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < 0 || valor > VALOR_MAXIMO) {
    throw new ErroNegocio(`${campo} inválido`)
  }
  if (valor === 0 && !permitirZero) throw new ErroNegocio(`Informe ${campo.toLowerCase()}`)
  return valor
}

function textoOpcional(valor: unknown, max: number): string | null {
  if (typeof valor !== 'string') return null
  const t = limparEspacos(valor)
  return t ? t.slice(0, max) : null
}

export function idCaixaAberto(db: Banco): number | null {
  const l = db.prepare(`SELECT id FROM caixas WHERE status = 'aberto'`).get() as { id: number } | undefined
  return l?.id ?? null
}

/** Nome do operador do caixa aberto automaticamente quando o controle de caixa está desligado. */
export const OPERADOR_AUTOMATICO = 'Dono'

/**
 * Controle de caixa (abertura com operador, fechamento cego). Desligado para a loja em que o
 * dono é o único operador: o PDV mantém um caixa aberto sozinho (`caixa.controle` = 'desligado').
 */
export function controleCaixaLigado(db: Banco): boolean {
  return obterConfig(db, 'caixa.controle') !== 'desligado'
}

export function definirControleCaixa(db: Banco, ligado: unknown): void {
  if (typeof ligado !== 'boolean') throw new ErroNegocio('Opção de controle de caixa inválida')
  definirConfig(db, 'caixa.controle', ligado ? 'ligado' : 'desligado')
}

/** Caixa aberto; com o controle desligado, abre um sozinho (sem fundo de troco) se não houver. */
export function garantirCaixaAberto(db: Banco): number | null {
  const id = idCaixaAberto(db)
  if (id !== null || controleCaixaLigado(db)) return id
  const r = db.prepare(`INSERT INTO caixas (status, operador, fundo_troco) VALUES ('aberto', ?, 0)`).run(OPERADOR_AUTOMATICO)
  return Number(r.lastInsertRowid)
}

export function exigirCaixaAberto(db: Banco): number {
  const id = garantirCaixaAberto(db)
  if (id === null) throw new ErroNegocio('O caixa está fechado. Abra o caixa (F4 na tela inicial) para vender.')
  return id
}

export function obterCaixa(db: Banco, id: number): ResumoCaixa | null {
  const c = db.prepare('SELECT * FROM caixas WHERE id = ?').get(id) as LinhaCaixa | undefined
  if (!c) return null

  const vendas = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'finalizada' THEN 1 END), 0) AS quantidade,
         COALESCE(SUM(CASE WHEN status = 'finalizada' THEN total END), 0) AS total,
         COALESCE(SUM(CASE WHEN status = 'cancelada' THEN 1 END), 0) AS canceladas,
         COALESCE(SUM(CASE WHEN status = 'finalizada' THEN troco END), 0) AS troco
       FROM vendas WHERE caixa_id = ?`
    )
    .get(id) as { quantidade: number; total: number; canceladas: number; troco: number }

  const recebido = Object.fromEntries(FORMAS.map((f) => [f, 0])) as Record<FormaContavel, Centavos>
  let vendidoFiado = 0
  const porForma = db
    .prepare(
      `SELECT p.forma, SUM(p.valor) AS valor
       FROM venda_pagamentos p JOIN vendas v ON v.id = p.venda_id
       WHERE v.caixa_id = ? AND v.status = 'finalizada'
       GROUP BY p.forma`
    )
    .all(id) as unknown as { forma: FormaPagamento; valor: number }[]
  for (const l of porForma) {
    if (l.forma === 'fiado') vendidoFiado = l.valor
    else recebido[l.forma] += l.valor
  }
  recebido.dinheiro -= vendas.troco

  // Cliente que veio pagar o fiado: o dinheiro entra na gaveta deste caixa.
  let recebimentosFiado = 0
  const pagamentosFiado = db
    .prepare(
      `SELECT forma, SUM(valor) AS valor FROM fiado_lancamentos
       WHERE caixa_id = ? AND tipo = 'pagamento' GROUP BY forma`
    )
    .all(id) as unknown as { forma: FormaContavel; valor: number }[]
  for (const l of pagamentosFiado) {
    if (l.forma in recebido) {
      recebido[l.forma] += l.valor
      recebimentosFiado += l.valor
    }
  }

  const movimentos = db
    .prepare(
      `SELECT id, tipo, valor, motivo, criado_em AS criadoEm FROM caixa_movimentos WHERE caixa_id = ? ORDER BY id`
    )
    .all(id) as unknown as MovimentoCaixa[]
  const soma = (tipo: MovimentoCaixa['tipo']) =>
    movimentos.filter((m) => m.tipo === tipo).reduce((s, m) => s + m.valor, 0)
  const sangrias = soma('sangria')
  const suprimentos = soma('suprimento')

  const linhasFechamento = db
    .prepare('SELECT forma, esperado, contado FROM caixa_fechamento WHERE caixa_id = ?')
    .all(id) as unknown as Omit<LinhaFechamento, 'diferenca'>[]

  return {
    id: c.id,
    status: c.status,
    operador: c.operador,
    fundoTroco: c.fundo_troco,
    abertoEm: c.aberto_em,
    fechadoEm: c.fechado_em,
    observacao: c.observacao,
    vendas: { quantidade: vendas.quantidade, total: vendas.total, canceladas: vendas.canceladas },
    recebido,
    vendidoFiado,
    recebimentosFiado,
    sangrias,
    suprimentos,
    dinheiroEsperado: c.fundo_troco + recebido.dinheiro + suprimentos - sangrias,
    movimentos,
    fechamento:
      c.status === 'fechado'
        ? FORMAS.map((forma) => {
            const l = linhasFechamento.find((x) => x.forma === forma)
            const esperado = l?.esperado ?? 0
            const contado = l?.contado ?? 0
            return { forma, esperado, contado, diferenca: contado - esperado }
          })
        : null
  }
}

export function caixaAberto(db: Banco): ResumoCaixa | null {
  const id = idCaixaAberto(db)
  return id === null ? null : obterCaixa(db, id)
}

/** Para as telas Início e Vender: com o controle desligado, nunca devolve "caixa fechado". */
export function caixaParaVender(db: Banco): ResumoCaixa | null {
  const id = garantirCaixaAberto(db)
  return id === null ? null : obterCaixa(db, id)
}

export function abrirCaixa(db: Banco, operador: unknown, fundoTroco: unknown): ResumoCaixa {
  return emTransacao(db, () => {
    if (idCaixaAberto(db) !== null) throw new ErroNegocio('Já existe um caixa aberto')
    const nome = textoOpcional(operador, 60)
    if (!nome) throw new ErroNegocio('Informe o nome do operador')
    const fundo = exigirValor(fundoTroco, 'Fundo de troco', { permitirZero: true })
    const r = db.prepare(`INSERT INTO caixas (status, operador, fundo_troco) VALUES ('aberto', ?, ?)`).run(nome, fundo)
    return obterCaixa(db, Number(r.lastInsertRowid))!
  })
}

/** Sangria (retirada de dinheiro da gaveta) ou suprimento (reforço de troco). */
export function movimentarCaixa(db: Banco, tipo: unknown, valor: unknown, motivo: unknown): ResumoCaixa {
  return emTransacao(db, () => {
    const caixaId = exigirCaixaAberto(db)
    if (tipo !== 'sangria' && tipo !== 'suprimento') throw new ErroNegocio('Movimento inválido')
    const v = exigirValor(valor, 'Valor')
    if (tipo === 'sangria') {
      const { dinheiroEsperado } = obterCaixa(db, caixaId)!
      if (v > dinheiroEsperado) {
        throw new ErroNegocio(`Sangria maior que o dinheiro na gaveta (${formatarMoeda(dinheiroEsperado)})`)
      }
    }
    db.prepare('INSERT INTO caixa_movimentos (caixa_id, tipo, valor, motivo) VALUES (?, ?, ?, ?)').run(
      caixaId,
      tipo,
      v,
      textoOpcional(motivo, 120)
    )
    return obterCaixa(db, caixaId)!
  })
}

/**
 * Fechamento cego: o operador informa o que contou em cada forma antes de ver o esperado.
 * Grava esperado × contado e fecha o caixa.
 */
export function fecharCaixa(db: Banco, contagem: unknown, observacao: unknown): ResumoCaixa {
  return emTransacao(db, () => {
    const caixaId = exigirCaixaAberto(db)
    const venda = db.prepare(`SELECT id FROM vendas WHERE status = 'aberta'`).get() as { id: number } | undefined
    if (venda) throw new ErroNegocio(`Finalize ou cancele a venda nº ${venda.id} antes de fechar o caixa`)

    const c = (contagem ?? {}) as Partial<Record<FormaContavel, unknown>>
    const contado = Object.fromEntries(
      FORMAS.map((f) => [f, exigirValor(c[f], `Valor contado em ${FORMAS_PAGAMENTO[f]}`, { permitirZero: true })])
    ) as Contagem

    const resumo = obterCaixa(db, caixaId)!
    const esperado: Contagem = { ...resumo.recebido, dinheiro: resumo.dinheiroEsperado }
    const inserir = db.prepare('INSERT INTO caixa_fechamento (caixa_id, forma, esperado, contado) VALUES (?, ?, ?, ?)')
    for (const f of FORMAS) inserir.run(caixaId, f, esperado[f], contado[f])

    db.prepare(`UPDATE caixas SET status = 'fechado', fechado_em = ${AGORA}, observacao = ? WHERE id = ?`).run(
      textoOpcional(observacao, 500),
      caixaId
    )
    return obterCaixa(db, caixaId)!
  })
}

export function listarCaixas(db: Banco, limite = 30): ResumoCaixa[] {
  const ids = db.prepare('SELECT id FROM caixas ORDER BY id DESC LIMIT ?').all(limite) as { id: number }[]
  return ids.map((l) => obterCaixa(db, l.id)!)
}

export function caixaPorId(db: Banco, id: unknown): ResumoCaixa {
  const c = obterCaixa(db, exigirId(id))
  if (!c) throw new ErroNegocio('Caixa não encontrado')
  return c
}
