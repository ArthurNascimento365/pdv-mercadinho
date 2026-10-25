import { formatarMoeda, type Centavos } from '@shared/dinheiro'
import {
  linkWhatsApp,
  type Cliente,
  type ClienteEntrada,
  type Cobranca,
  type CompraEmAberto,
  type ExtratoCliente,
  type LancamentoFiado,
  type TipoLancamentoFiado
} from '@shared/fiado'
import { limparEspacos, normalizarBusca } from '@shared/texto'
import { exigirCaixaAberto } from '../caixa/caixa'
import type { Banco } from '../db/conexao'
import { emTransacao } from '../db/transacao'
import { ErroNegocio, exigirId } from '../erros'
import { obterConfig } from '../repos/configuracoes'

const LIMITE_MAXIMO = 10_000_000
const FORMAS_RECEBIMENTO = ['dinheiro', 'debito', 'credito', 'pix'] as const
const DIA_MS = 86_400_000

interface LinhaCliente {
  id: number
  nome: string
  telefone: string | null
  limite: number
  dia_acerto: number | null
  observacao: string | null
  ativo: number
  criado_em: string
}

interface LinhaLancamento {
  id: number
  tipo: TipoLancamentoFiado
  valor: number
  venda_id: number | null
  forma: string | null
  autorizado: number
  criado_em: string
}

export function diasAtrasoPermitidos(db: Banco): number {
  const n = Number(obterConfig(db, 'fiado.dias_atraso'))
  return Number.isInteger(n) && n > 0 ? n : 30
}

/**
 * Compras ainda não pagas: o pagamento quita as compras mais antigas primeiro.
 * Estorno (venda cancelada) tira a compra daquela venda inteira.
 */
export function comprasEmAberto(lancamentos: LinhaLancamento[]): CompraEmAberto[] {
  const estornadas = new Set(lancamentos.filter((l) => l.tipo === 'estorno').map((l) => l.venda_id))
  const compras = lancamentos
    .filter((l) => l.tipo === 'compra' && !(l.venda_id !== null && estornadas.has(l.venda_id)))
    .map((l) => ({ vendaId: l.venda_id, data: l.criado_em, valor: l.valor, restante: l.valor }))
  let pago = lancamentos.filter((l) => l.tipo === 'pagamento').reduce((s, l) => s + l.valor, 0)
  for (const c of compras) {
    const abate = Math.min(pago, c.restante)
    c.restante -= abate
    pago -= abate
  }
  return compras.filter((c) => c.restante > 0)
}

function lancamentosDe(db: Banco, clienteId: number): LinhaLancamento[] {
  return db
    .prepare('SELECT * FROM fiado_lancamentos WHERE cliente_id = ? ORDER BY id')
    .all(clienteId) as unknown as LinhaLancamento[]
}

function paraCliente(l: LinhaCliente, lancamentos: LinhaLancamento[], agora = Date.now()): Cliente {
  const saldo = lancamentos.reduce((s, x) => s + (x.tipo === 'compra' ? x.valor : -x.valor), 0)
  const abertos = comprasEmAberto(lancamentos)
  const maisAntiga = abertos[0]?.data
  return {
    id: l.id,
    nome: l.nome,
    telefone: l.telefone,
    limite: l.limite,
    diaAcerto: l.dia_acerto,
    observacao: l.observacao,
    ativo: l.ativo === 1,
    saldo,
    diasEmAberto: maisAntiga ? Math.floor((agora - new Date(maisAntiga).getTime()) / DIA_MS) : null,
    criadoEm: l.criado_em
  }
}

export function obterCliente(db: Banco, id: number): Cliente | null {
  const l = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id) as LinhaCliente | undefined
  return l ? paraCliente(l, lancamentosDe(db, id)) : null
}

export function buscarClientes(db: Banco, termo: string, { incluirInativos = false } = {}): Cliente[] {
  const palavras = normalizarBusca(termo).split(' ').filter(Boolean)
  const condicoes = incluirInativos ? [] : ['ativo = 1']
  const params: string[] = []
  for (const p of palavras) {
    condicoes.push(`(nome_busca LIKE ? OR telefone LIKE ?)`)
    params.push(`%${p}%`, `%${p.replace(/\D/g, '') || '\u0000'}%`)
  }
  const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''
  const linhas = db
    .prepare(`SELECT * FROM clientes ${onde} ORDER BY nome_busca LIMIT 200`)
    .all(...params) as unknown as LinhaCliente[]
  return linhas.map((l) => paraCliente(l, lancamentosDe(db, l.id)))
}

export function validarCliente(dado: unknown): ClienteEntrada {
  const d = (dado ?? {}) as Record<string, unknown>
  const nome = typeof d['nome'] === 'string' ? limparEspacos(d['nome']) : ''
  if (!nome) throw new ErroNegocio('Informe o nome do cliente')
  if (nome.length > 80) throw new ErroNegocio('Nome com mais de 80 caracteres')

  let telefone: string | null = null
  if (typeof d['telefone'] === 'string' && d['telefone'].trim()) {
    telefone = d['telefone'].replace(/\D/g, '')
    if (telefone.length < 10 || telefone.length > 13) throw new ErroNegocio('Telefone deve ter DDD + número')
  }
  const limite = d['limite']
  if (typeof limite !== 'number' || !Number.isSafeInteger(limite) || limite < 0 || limite > LIMITE_MAXIMO) {
    throw new ErroNegocio('Limite de crédito inválido')
  }
  let diaAcerto: number | null = null
  if (d['diaAcerto'] !== null && d['diaAcerto'] !== undefined) {
    const dia = d['diaAcerto']
    if (typeof dia !== 'number' || !Number.isInteger(dia) || dia < 1 || dia > 31) {
      throw new ErroNegocio('Dia de acerto deve ser de 1 a 31')
    }
    diaAcerto = dia
  }
  const obs = typeof d['observacao'] === 'string' ? limparEspacos(d['observacao']).slice(0, 300) : ''
  return { nome, telefone, limite, diaAcerto, observacao: obs || null }
}

export function criarCliente(db: Banco, dado: unknown): Cliente {
  const c = validarCliente(dado)
  const r = db
    .prepare(
      `INSERT INTO clientes (nome, nome_busca, telefone, limite, dia_acerto, observacao) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(c.nome, normalizarBusca(c.nome), c.telefone, c.limite, c.diaAcerto, c.observacao)
  return obterCliente(db, Number(r.lastInsertRowid))!
}

export function atualizarCliente(db: Banco, id: unknown, dado: unknown): Cliente {
  const clienteId = exigirId(id)
  const c = validarCliente(dado)
  const r = db
    .prepare(
      `UPDATE clientes SET nome = ?, nome_busca = ?, telefone = ?, limite = ?, dia_acerto = ?, observacao = ?
       WHERE id = ?`
    )
    .run(c.nome, normalizarBusca(c.nome), c.telefone, c.limite, c.diaAcerto, c.observacao, clienteId)
  if (r.changes === 0) throw new ErroNegocio('Cliente não encontrado')
  return obterCliente(db, clienteId)!
}

export function definirAtivoCliente(db: Banco, id: unknown, ativo: unknown): Cliente {
  const clienteId = exigirId(id)
  const c = obterCliente(db, clienteId)
  if (!c) throw new ErroNegocio('Cliente não encontrado')
  if (ativo !== true && c.saldo > 0) throw new ErroNegocio(`${c.nome} ainda deve ${formatarMoeda(c.saldo)}`)
  db.prepare('UPDATE clientes SET ativo = ? WHERE id = ?').run(ativo === true ? 1 : 0, clienteId)
  return obterCliente(db, clienteId)!
}

/**
 * Pode comprar mais `valor` no fiado? Bloqueia acima do limite ou com compra em aberto
 * há mais dias que o permitido. O erro tem código "gerente": a senha do gerente libera.
 */
export function verificarCredito(db: Banco, clienteId: number, valor: Centavos): void {
  const c = obterCliente(db, clienteId)
  if (!c) throw new ErroNegocio('Cliente não encontrado')
  if (!c.ativo) throw new ErroNegocio(`${c.nome} está inativo`)
  const dias = diasAtrasoPermitidos(db)
  if (c.diasEmAberto !== null && c.diasEmAberto > dias) {
    throw new ErroNegocio(`${c.nome} tem fiado em aberto há ${c.diasEmAberto} dias (máximo ${dias})`, 'gerente')
  }
  if (c.saldo + valor > c.limite) {
    throw new ErroNegocio(
      `Passa do limite de ${c.nome}: deve ${formatarMoeda(c.saldo)} + ${formatarMoeda(valor)} > limite ${formatarMoeda(c.limite)}`,
      'gerente'
    )
  }
}

export function lancarFiado(
  db: Banco,
  l: { clienteId: number; tipo: TipoLancamentoFiado; valor: Centavos; vendaId?: number; caixaId?: number; forma?: string; autorizado?: boolean }
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO fiado_lancamentos (cliente_id, tipo, valor, venda_id, caixa_id, forma, autorizado)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(l.clienteId, l.tipo, l.valor, l.vendaId ?? null, l.caixaId ?? null, l.forma ?? null, l.autorizado ? 1 : 0)
      .lastInsertRowid
  )
}

/** Cliente paga parte ou tudo do que deve. O dinheiro entra no caixa aberto. */
export function receberFiado(db: Banco, clienteId: unknown, valor: unknown, forma: unknown): { lancamentoId: number; cliente: Cliente } {
  return emTransacao(db, () => {
    const id = exigirId(clienteId)
    const caixaId = exigirCaixaAberto(db)
    const c = obterCliente(db, id)
    if (!c) throw new ErroNegocio('Cliente não encontrado')
    if (!FORMAS_RECEBIMENTO.includes(forma as (typeof FORMAS_RECEBIMENTO)[number])) {
      throw new ErroNegocio('Forma de recebimento inválida')
    }
    if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor <= 0) throw new ErroNegocio('Informe o valor')
    if (c.saldo <= 0) throw new ErroNegocio(`${c.nome} não tem saldo devedor`)
    if (valor > c.saldo) throw new ErroNegocio(`Valor maior que o saldo devedor (${formatarMoeda(c.saldo)})`)
    const lancamentoId = lancarFiado(db, { clienteId: id, tipo: 'pagamento', valor, caixaId, forma: forma as string })
    return { lancamentoId, cliente: obterCliente(db, id)! }
  })
}

export function extratoCliente(db: Banco, clienteId: unknown): ExtratoCliente {
  const id = exigirId(clienteId)
  const linhas = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id) as LinhaCliente | undefined
  if (!linhas) throw new ErroNegocio('Cliente não encontrado')
  const lancs = lancamentosDe(db, id)
  let saldo = 0
  const lancamentos: LancamentoFiado[] = lancs.map((l) => {
    saldo += l.tipo === 'compra' ? l.valor : -l.valor
    return {
      id: l.id,
      tipo: l.tipo,
      valor: l.valor,
      vendaId: l.venda_id,
      forma: l.forma,
      autorizado: l.autorizado === 1,
      criadoEm: l.criado_em,
      saldoApos: saldo
    }
  })
  return { cliente: paraCliente(linhas, lancs), lancamentos, emAberto: comprasEmAberto(lancs) }
}

const data = (iso: string): string => new Date(iso).toLocaleDateString('pt-BR')
const real = (c: number): string => formatarMoeda(c).replace(/ /g, ' ')

/** Mensagem de cobrança para o WhatsApp: saldo, compras em aberto e chave Pix (se houver). */
export function cobrancaCliente(db: Banco, clienteId: unknown): Cobranca {
  const { cliente, emAberto } = extratoCliente(db, clienteId)
  if (cliente.saldo <= 0) throw new ErroNegocio(`${cliente.nome} não tem saldo devedor`)
  const loja = obterConfig(db, 'loja.nome') ?? 'Mercadinho'
  let chavePix: string | null = null
  try {
    chavePix = (JSON.parse(obterConfig(db, 'pix') ?? '{}') as { chave?: string }).chave || null
  } catch {
    chavePix = null
  }
  const primeiroNome = cliente.nome.split(' ')[0]
  const linhas = [
    `Olá, ${primeiroNome}! Aqui é do ${loja}.`,
    `Seu saldo no fiado está em ${real(cliente.saldo)}.`,
    '',
    'Compras em aberto:',
    ...emAberto.map((c) => `• ${data(c.data)}: ${real(c.restante)}${c.restante < c.valor ? ` (de ${real(c.valor)})` : ''}`)
  ]
  if (chavePix) linhas.push('', `Pode pagar por Pix: ${chavePix}`)
  linhas.push('', 'Obrigado!')
  const texto = linhas.join('\n')
  return { texto, link: linkWhatsApp(cliente.telefone, texto) }
}
