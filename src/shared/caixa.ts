import type { Centavos } from './dinheiro'
import type { FormaContavel } from './vendas'

export interface MovimentoCaixa {
  id: number
  tipo: 'sangria' | 'suprimento'
  valor: Centavos
  motivo: string | null
  criadoEm: string
}

export interface LinhaFechamento {
  forma: FormaContavel
  esperado: Centavos
  contado: Centavos
  /** contado − esperado: negativo = falta (furo), positivo = sobra. */
  diferenca: Centavos
}

export interface ResumoCaixa {
  id: number
  status: 'aberto' | 'fechado'
  operador: string
  fundoTroco: Centavos
  abertoEm: string
  fechadoEm: string | null
  observacao: string | null
  vendas: { quantidade: number; total: Centavos; canceladas: number }
  /** Recebido por forma (vendas + pagamentos de fiado). Dinheiro já descontado do troco dado. */
  recebido: Record<FormaContavel, Centavos>
  /** Vendido a prazo (não entra na gaveta). */
  vendidoFiado: Centavos
  /** Pagamentos de fiado recebidos neste caixa (já somados em `recebido`). */
  recebimentosFiado: Centavos
  sangrias: Centavos
  suprimentos: Centavos
  /** Fundo + dinheiro das vendas + suprimentos − sangrias. */
  dinheiroEsperado: Centavos
  movimentos: MovimentoCaixa[]
  /** Só depois de fechado. */
  fechamento: LinhaFechamento[] | null
}

export type Contagem = Record<FormaContavel, Centavos>
