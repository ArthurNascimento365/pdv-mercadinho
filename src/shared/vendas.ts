import { lerMoeda, lerQuantidade, type Centavos, type Milesimos } from './dinheiro'
import type { TipoPreco } from './precos'
import type { Produto, Unidade } from './produtos'

export const FORMAS_PAGAMENTO = {
  dinheiro: 'Dinheiro',
  debito: 'Débito',
  credito: 'Crédito',
  pix: 'Pix',
  fiado: 'Fiado'
} as const

export type FormaPagamento = keyof typeof FORMAS_PAGAMENTO

/** Formas que entram no caixa e são contadas no fechamento (fiado é a prazo). */
export type FormaContavel = Exclude<FormaPagamento, 'fiado'>
export const FORMAS_CONTAVEIS: FormaContavel[] = ['dinheiro', 'debito', 'credito', 'pix']

export function formaValida(forma: unknown): forma is FormaPagamento {
  return typeof forma === 'string' && Object.hasOwn(FORMAS_PAGAMENTO, forma)
}

export interface ItemVenda {
  id: number
  sequencia: number
  produtoId: number
  descricao: string
  unidade: Unidade
  quantidade: Milesimos
  precoUnitario: Centavos
  totalBruto: Centavos
  desconto: Centavos
  total: Centavos
  cancelado: boolean
  /** De onde veio o preço: normal, promoção, atacarejo ou total impresso na etiqueta da balança. */
  tipoPreco: TipoPreco
  /** Preço de tabela (normal ou promoção) quando o item entrou. */
  precoTabela: Centavos
}

export interface PagamentoVenda {
  id: number
  forma: FormaPagamento
  valor: Centavos
}

export interface Venda {
  id: number
  status: 'aberta' | 'finalizada' | 'cancelada'
  iniciadaEm: string
  finalizadaEm: string | null
  canceladaEm: string | null
  /** Soma dos itens não cancelados, já com o desconto de cada item. */
  subtotal: Centavos
  /** Desconto no total da venda. */
  desconto: Centavos
  total: Centavos
  pago: Centavos
  /** Quanto ainda falta receber (nunca negativo). */
  restante: Centavos
  troco: Centavos
  caixaId: number | null
  /** Cliente identificado na venda (obrigatório para pagar no fiado). */
  clienteId: number | null
  clienteNome: string | null
  itens: ItemVenda[]
  pagamentos: PagamentoVenda[]
}

export type ResultadoAdicionar =
  | { tipo: 'adicionado'; venda: Venda }
  /** Produto pesado digitado sem etiqueta: o caixa precisa informar o peso. */
  | { tipo: 'pedirQuantidade'; produto: Produto }
  | { tipo: 'naoEncontrado'; codigo: string }

/**
 * O que o operador digita no campo de código: "7891000100103", "3*7891000100103"
 * ou "0,350*12". Retorna null se o multiplicador for inválido.
 */
export function lerEntradaCaixa(texto: string): { codigo: string; quantidade: Milesimos | null } | null {
  const limpo = texto.trim()
  const asterisco = limpo.indexOf('*')
  if (asterisco === -1) return limpo ? { codigo: limpo, quantidade: null } : null
  const quantidade = lerQuantidade(limpo.slice(0, asterisco))
  const codigo = limpo.slice(asterisco + 1).trim()
  if (quantidade === null || quantidade <= 0 || !codigo) return null
  return { codigo, quantidade }
}

/**
 * Desconto digitado: "2,50" (reais) ou "10%" / "7,5%" (sobre `base`).
 * Retorna null se inválido. Não verifica limite: isso é regra do main.
 */
export function lerDesconto(texto: string, base: Centavos): Centavos | null {
  const limpo = texto.replace(/\s/g, '')
  const pct = /^(\d{1,3})(?:[,.](\d{1,2}))?%$/.exec(limpo)
  if (pct) {
    const [, inteiro = '0', fracao = ''] = pct
    const centesimosDePonto = Number(inteiro) * 100 + Number(fracao.padEnd(2, '0'))
    if (centesimosDePonto > 10_000) return null
    return Math.round((base * centesimosDePonto) / 10_000)
  }
  const valor = lerMoeda(limpo)
  return valor === null || valor < 0 ? null : valor
}
