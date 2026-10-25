import type {
  LinhaAbc,
  LinhaFechamentoRelatorio,
  LinhaMargem,
  LinhaSemGiro,
  Periodo,
  RelatorioFiado,
  RelatorioMargem,
  RelatorioVendas
} from '@shared/relatorios'
import type { Unidade } from '@shared/produtos'
import type { FormaPagamento } from '@shared/vendas'
import { obterCaixa } from '../caixa/caixa'
import type { Banco } from '../db/conexao'
import { ErroNegocio } from '../erros'
import { buscarClientes, diasAtrasoPermitidos } from '../fiado/fiado'

const DIA_MS = 86_400_000

/** Converte o período (datas locais) para o intervalo em UTC usado nas colunas *_em. */
export function intervalo(p: unknown): [string, string] {
  const d = (p ?? {}) as Partial<Periodo>
  const valida = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  if (!valida(d.de) || !valida(d.ate)) throw new ErroNegocio('Período inválido')
  if (d.de > d.ate) throw new ErroNegocio('A data inicial é depois da final')
  return [new Date(`${d.de}T00:00:00`).toISOString(), new Date(`${d.ate}T23:59:59.999`).toISOString()]
}

export function relatorioVendas(db: Banco, periodo: unknown): RelatorioVendas {
  const [ini, fim] = intervalo(periodo)
  const t = db
    .prepare(
      `SELECT
         COALESCE(SUM(status = 'finalizada'), 0) AS quantidade,
         COALESCE(SUM(CASE WHEN status = 'finalizada' THEN total END), 0) AS faturamento,
         COALESCE(SUM(CASE WHEN status = 'finalizada' THEN desconto END), 0) AS descontos_venda
       FROM vendas WHERE finalizada_em BETWEEN ? AND ?`
    )
    .get(ini, fim) as { quantidade: number; faturamento: number; descontos_venda: number }
  const descontosItens = (
    db
      .prepare(
        `SELECT COALESCE(SUM(i.desconto), 0) AS d FROM venda_itens i JOIN vendas v ON v.id = i.venda_id
         WHERE v.status = 'finalizada' AND i.cancelado = 0 AND v.finalizada_em BETWEEN ? AND ?`
      )
      .get(ini, fim) as { d: number }
  ).d
  // Cancelada conta pela data do cancelamento (inclui as que nem chegaram a finalizar).
  const canceladas = (
    db.prepare(`SELECT count(*) AS n FROM vendas WHERE status = 'cancelada' AND cancelada_em BETWEEN ? AND ?`).get(ini, fim) as {
      n: number
    }
  ).n

  const porDia = db
    .prepare(
      `SELECT date(finalizada_em, 'localtime') AS dia, count(*) AS quantidade, SUM(total) AS total
       FROM vendas WHERE status = 'finalizada' AND finalizada_em BETWEEN ? AND ?
       GROUP BY dia ORDER BY dia`
    )
    .all(ini, fim) as unknown as RelatorioVendas['porDia']

  const formas = db
    .prepare(
      `SELECT p.forma, SUM(p.valor) AS valor FROM venda_pagamentos p JOIN vendas v ON v.id = p.venda_id
       WHERE v.status = 'finalizada' AND v.finalizada_em BETWEEN ? AND ? GROUP BY p.forma`
    )
    .all(ini, fim) as unknown as { forma: FormaPagamento; valor: number }[]
  const troco = (
    db
      .prepare(`SELECT COALESCE(SUM(troco), 0) AS t FROM vendas WHERE status = 'finalizada' AND finalizada_em BETWEEN ? AND ?`)
      .get(ini, fim) as { t: number }
  ).t
  const porForma = formas
    .map((f) => ({ forma: f.forma, valor: f.forma === 'dinheiro' ? f.valor - troco : f.valor }))
    .sort((a, b) => b.valor - a.valor)

  return {
    quantidade: t.quantidade,
    canceladas,
    faturamento: t.faturamento,
    descontos: t.descontos_venda + descontosItens,
    ticketMedio: t.quantidade ? Math.round(t.faturamento / t.quantidade) : 0,
    porDia,
    porForma
  }
}

export function relatorioFechamentos(db: Banco, periodo: unknown): LinhaFechamentoRelatorio[] {
  const [ini, fim] = intervalo(periodo)
  const ids = db
    .prepare(`SELECT id FROM caixas WHERE status = 'fechado' AND fechado_em BETWEEN ? AND ? ORDER BY fechado_em`)
    .all(ini, fim) as { id: number }[]
  return ids.map(({ id }) => {
    const c = obterCaixa(db, id)!
    const linhas = c.fechamento ?? []
    const esperado = linhas.reduce((s, l) => s + l.esperado, 0)
    const contado = linhas.reduce((s, l) => s + l.contado, 0)
    return {
      caixaId: id,
      operador: c.operador,
      abertoEm: c.abertoEm,
      fechadoEm: c.fechadoEm,
      vendido: c.vendas.total,
      esperado,
      contado,
      diferenca: contado - esperado
    }
  })
}

interface LinhaVendida {
  produto_id: number
  descricao: string
  categoria: string | null
  unidade: Unidade
  quantidade: number
  receita: number
  custo: number | null
}

/**
 * Receita por item já com o desconto da venda rateado (proporcional ao valor do item).
 * Custo: o gravado na venda; para vendas antigas, o custo atual do produto.
 */
function vendidosPorItem(db: Banco, periodo: unknown): LinhaVendida[] {
  const [ini, fim] = intervalo(periodo)
  return db
    .prepare(
      `SELECT i.produto_id, p.descricao, c.nome AS categoria, p.unidade, i.quantidade,
         CASE WHEN v.subtotal > 0 THEN i.total * 1.0 * v.total / v.subtotal ELSE 0 END AS receita,
         CASE WHEN COALESCE(i.custo_unitario, p.preco_custo) IS NULL THEN NULL
              ELSE COALESCE(i.custo_unitario, p.preco_custo) * 1.0 * i.quantidade / 1000 END AS custo
       FROM venda_itens i
       JOIN vendas v ON v.id = i.venda_id
       JOIN produtos p ON p.id = i.produto_id
       LEFT JOIN categorias c ON c.id = p.categoria_id
       WHERE v.status = 'finalizada' AND i.cancelado = 0 AND v.finalizada_em BETWEEN ? AND ?`
    )
    .all(ini, fim) as unknown as LinhaVendida[]
}

function agregar(linhas: LinhaVendida[], chave: (l: LinhaVendida) => string, rotulo: (l: LinhaVendida) => Omit<LinhaMargem, 'quantidade' | 'receita' | 'custo' | 'lucro' | 'margem' | 'semCusto'>): LinhaMargem[] {
  const mapa = new Map<string, { base: ReturnType<typeof rotulo>; quantidade: number; receita: number; custo: number; semCusto: boolean; unidades: Set<Unidade> }>()
  for (const l of linhas) {
    const k = chave(l)
    const atual = mapa.get(k) ?? { base: rotulo(l), quantidade: 0, receita: 0, custo: 0, semCusto: false, unidades: new Set<Unidade>() }
    atual.quantidade += l.quantidade
    atual.receita += l.receita
    atual.custo += l.custo ?? 0
    atual.semCusto ||= l.custo === null
    atual.unidades.add(l.unidade)
    mapa.set(k, atual)
  }
  return [...mapa.values()]
    .map((a) => {
      const receita = Math.round(a.receita)
      const custo = Math.round(a.custo)
      return {
        ...a.base,
        quantidade: a.quantidade,
        unidade: a.unidades.size === 1 ? [...a.unidades][0]! : null,
        receita,
        custo,
        lucro: receita - custo,
        margem: receita > 0 ? Math.round(((receita - custo) / receita) * 1000) / 10 : null,
        semCusto: a.semCusto
      }
    })
    .sort((a, b) => b.lucro - a.lucro)
}

export function relatorioMargem(db: Banco, periodo: unknown): RelatorioMargem {
  const linhas = vendidosPorItem(db, periodo)
  const produtos = agregar(
    linhas,
    (l) => String(l.produto_id),
    (l) => ({ chave: String(l.produto_id), descricao: l.descricao, categoria: l.categoria, unidade: l.unidade })
  )
  const categorias = agregar(
    linhas,
    (l) => l.categoria ?? '',
    (l) => ({ chave: l.categoria ?? '', descricao: l.categoria ?? 'Sem categoria', categoria: l.categoria, unidade: null })
  )
  const total =
    agregar(linhas, () => 'total', () => ({ chave: 'total', descricao: 'Total', categoria: null, unidade: null }))[0] ??
    { chave: 'total', descricao: 'Total', categoria: null, unidade: null, quantidade: 0, receita: 0, custo: 0, lucro: 0, margem: null, semCusto: false }
  return { produtos, categorias, total: { ...total, unidade: null } }
}

/** Curva ABC por faturamento: A até 80% acumulado, B até 95%, C o resto. */
export function curvaAbc(db: Banco, periodo: unknown): LinhaAbc[] {
  const porProduto = new Map<number, { descricao: string; receita: number }>()
  for (const l of vendidosPorItem(db, periodo)) {
    const a = porProduto.get(l.produto_id) ?? { descricao: l.descricao, receita: 0 }
    a.receita += l.receita
    porProduto.set(l.produto_id, a)
  }
  const ordenados = [...porProduto.entries()]
    .map(([produtoId, a]) => ({ produtoId, descricao: a.descricao, receita: Math.round(a.receita) }))
    .sort((a, b) => b.receita - a.receita)
  const total = ordenados.reduce((s, l) => s + l.receita, 0)
  let acumulado = 0
  return ordenados.map((l) => {
    // Classe pela posição antes do item: o que "entra" no 80% é A.
    const antes = total ? (acumulado / total) * 100 : 0
    acumulado += l.receita
    const pct = total ? (acumulado / total) * 100 : 0
    return {
      ...l,
      participacao: total ? Math.round((l.receita / total) * 1000) / 10 : 0,
      acumulado: Math.round(pct * 10) / 10,
      classe: antes < 80 ? 'A' : antes < 95 ? 'B' : 'C'
    }
  })
}

export function relatorioFiado(db: Banco): RelatorioFiado {
  const diasAtraso = diasAtrasoPermitidos(db)
  const clientes = buscarClientes(db, '', { incluirInativos: true })
    .filter((c) => c.saldo > 0)
    .map((c) => ({
      clienteId: c.id,
      nome: c.nome,
      telefone: c.telefone,
      saldo: c.saldo,
      limite: c.limite,
      diasEmAberto: c.diasEmAberto,
      atrasado: (c.diasEmAberto ?? 0) > diasAtraso
    }))
    .sort((a, b) => Number(b.atrasado) - Number(a.atrasado) || b.saldo - a.saldo)
  return {
    clientes,
    totalAReceber: clientes.reduce((s, c) => s + c.saldo, 0),
    totalAtrasado: clientes.filter((c) => c.atrasado).reduce((s, c) => s + c.saldo, 0),
    diasAtraso
  }
}

/** Produtos com estoque e sem venda há mais de `dias` (candidatos a promoção). */
export function produtosSemGiro(db: Banco, dias: unknown = 30, agora = new Date()): LinhaSemGiro[] {
  const n = typeof dias === 'number' && Number.isInteger(dias) && dias > 0 ? dias : 30
  const limite = new Date(agora.getTime() - n * DIA_MS).toISOString()
  const linhas = db
    .prepare(
      `SELECT p.id, p.descricao, c.nome AS categoria, p.unidade, p.estoque_atual, p.preco_custo, p.criado_em,
         (SELECT max(v.finalizada_em) FROM venda_itens i JOIN vendas v ON v.id = i.venda_id
          WHERE i.produto_id = p.id AND i.cancelado = 0 AND v.status = 'finalizada') AS ultima
       FROM produtos p LEFT JOIN categorias c ON c.id = p.categoria_id
       WHERE p.ativo = 1 AND p.estoque_atual > 0`
    )
    .all() as unknown as {
    id: number
    descricao: string
    categoria: string | null
    unidade: Unidade
    estoque_atual: number
    preco_custo: number | null
    criado_em: string
    ultima: string | null
  }[]
  return linhas
    .filter((l) => (l.ultima ?? l.criado_em) < limite)
    .map((l) => ({
      produtoId: l.id,
      descricao: l.descricao,
      categoria: l.categoria,
      unidade: l.unidade,
      estoque: l.estoque_atual,
      ultimaVenda: l.ultima,
      valorParado: l.preco_custo === null ? null : Math.round((l.preco_custo * l.estoque_atual) / 1000)
    }))
    .sort((a, b) => (b.valorParado ?? 0) - (a.valorParado ?? 0))
}
