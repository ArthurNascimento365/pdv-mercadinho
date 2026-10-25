import type { Centavos } from './dinheiro'

export interface ClienteEntrada {
  nome: string
  /** Só dígitos, com DDD. */
  telefone: string | null
  /** Quanto o cliente pode dever. 0 = fiado só com a senha do gerente. */
  limite: Centavos
  diaAcerto: number | null
  observacao: string | null
}

export interface Cliente extends ClienteEntrada {
  id: number
  ativo: boolean
  /** Positivo = deve; negativo = tem crédito. */
  saldo: Centavos
  /** Dias desde a compra mais antiga ainda não paga (null = nada em aberto). */
  diasEmAberto: number | null
  criadoEm: string
}

export type TipoLancamentoFiado = 'compra' | 'pagamento' | 'estorno'

export interface LancamentoFiado {
  id: number
  tipo: TipoLancamentoFiado
  valor: Centavos
  vendaId: number | null
  forma: string | null
  autorizado: boolean
  criadoEm: string
  saldoApos: Centavos
}

export interface CompraEmAberto {
  vendaId: number | null
  data: string
  valor: Centavos
  restante: Centavos
}

export interface ExtratoCliente {
  cliente: Cliente
  lancamentos: LancamentoFiado[]
  emAberto: CompraEmAberto[]
}

export interface Cobranca {
  texto: string
  /** null = cliente sem telefone válido. */
  link: string | null
}

/** Link wa.me com a mensagem pronta. Aceita telefone com ou sem 55 (10 ou 11 dígitos + DDD). */
export function linkWhatsApp(telefone: string | null, texto: string): string | null {
  const digitos = (telefone ?? '').replace(/\D/g, '')
  let numero: string | null = null
  if (digitos.length === 10 || digitos.length === 11) numero = `55${digitos}`
  else if (digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)) numero = digitos
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` : null
}
