import type { Centavos, Milesimos } from './dinheiro'
import type { Unidade } from './produtos'
import type { FormaPagamento } from './vendas'

/** Datas locais no formato AAAA-MM-DD, inclusivas. */
export interface Periodo {
  de: string
  ate: string
}

export interface RelatorioVendas {
  quantidade: number
  canceladas: number
  faturamento: Centavos
  descontos: Centavos
  ticketMedio: Centavos
  porDia: { dia: string; quantidade: number; total: Centavos }[]
  /** Dinheiro já sem o troco. */
  porForma: { forma: FormaPagamento; valor: Centavos }[]
}

export interface LinhaFechamentoRelatorio {
  caixaId: number
  operador: string
  abertoEm: string
  fechadoEm: string | null
  vendido: Centavos
  esperado: Centavos
  contado: Centavos
  diferenca: Centavos
}

export interface LinhaMargem {
  chave: string
  descricao: string
  categoria: string | null
  quantidade: Milesimos
  unidade: Unidade | null
  receita: Centavos
  custo: Centavos
  lucro: Centavos
  /** Margem sobre a receita (0–100, uma casa); null = sem receita. */
  margem: number | null
  /** Algum item vendido sem custo cadastrado (lucro superestimado). */
  semCusto: boolean
}

export interface RelatorioMargem {
  produtos: LinhaMargem[]
  categorias: LinhaMargem[]
  total: LinhaMargem
}

export interface LinhaAbc {
  produtoId: number
  descricao: string
  receita: Centavos
  /** Participação (0–100, uma casa) e acumulado. */
  participacao: number
  acumulado: number
  classe: 'A' | 'B' | 'C'
}

export interface LinhaFiadoAberto {
  clienteId: number
  nome: string
  telefone: string | null
  saldo: Centavos
  limite: Centavos
  diasEmAberto: number | null
  atrasado: boolean
}

export interface RelatorioFiado {
  clientes: LinhaFiadoAberto[]
  totalAReceber: Centavos
  totalAtrasado: Centavos
  diasAtraso: number
}

export interface LinhaSemGiro {
  produtoId: number
  descricao: string
  categoria: string | null
  unidade: Unidade
  estoque: Milesimos
  ultimaVenda: string | null
  /** Estoque × custo: dinheiro parado na prateleira. */
  valorParado: Centavos | null
}

/** Período comum de relatórios a partir de hoje (datas locais). */
export function periodoPadrao(tipo: 'hoje' | 'semana' | 'mes', hoje = new Date()): Periodo {
  const iso = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const ate = iso(hoje)
  if (tipo === 'hoje') return { de: ate, ate }
  if (tipo === 'semana') return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 6)), ate }
  return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), ate }
}
