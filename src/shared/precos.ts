import type { Centavos, Milesimos } from './dinheiro'

export type TipoPreco = 'normal' | 'promocao' | 'atacado' | 'etiqueta'

export interface RegrasPreco {
  precoVenda: Centavos
  precoPromocional: Centavos | null
  /** AAAA-MM-DD (datas locais, inclusivas). */
  promocaoInicio: string | null
  promocaoFim: string | null
  atacadoQuantidade: Milesimos | null
  atacadoPreco: Centavos | null
}

/** Data local de hoje em AAAA-MM-DD. */
export function hojeLocal(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function promocaoAtiva(p: RegrasPreco, hoje: string): boolean {
  return (
    p.precoPromocional !== null &&
    p.promocaoInicio !== null &&
    p.promocaoFim !== null &&
    p.promocaoInicio <= hoje &&
    hoje <= p.promocaoFim
  )
}

/** Preço de tabela de hoje: o promocional, se a promoção estiver valendo. */
export function precoTabela(p: RegrasPreco, hoje: string): { preco: Centavos; tipo: 'normal' | 'promocao' } {
  return promocaoAtiva(p, hoje) ? { preco: p.precoPromocional!, tipo: 'promocao' } : { preco: p.precoVenda, tipo: 'normal' }
}

/**
 * Tabela de preço do item na venda: varejo = PROMOCIONAL (preço de cadastro) e a_prazo = NORMAL
 * (preço maior). O cupom mostra só o preço cobrado; a tela Vender marca o item PROMOCIONAL.
 */
export type TabelaPreco = 'varejo' | 'a_prazo'

export const TABELAS_PRECO: Record<TabelaPreco, string> = { varejo: 'PROMOCIONAL', a_prazo: 'NORMAL' }

export function tabelaValida(t: unknown): t is TabelaPreco {
  return t === 'varejo' || t === 'a_prazo'
}

/** Configuração da tabela "A prazo". `percentual` em centésimos de ponto: 800 = 8,00%. */
export interface ConfigAPrazo {
  percentual: number
  /** Abrir a janela de escolha da tabela a cada item lançado. */
  perguntar: boolean
}

export const CONFIG_A_PRAZO_PADRAO: ConfigAPrazo = { percentual: 0, perguntar: true }

/**
 * Preço unitário na tabela "A prazo": o preço fixo do produto, se houver; senão o preço que
 * estiver valendo no varejo (normal, promoção ou atacado) mais o percentual, arredondado.
 */
export function precoAPrazo(base: Centavos, fixo: Centavos | null, percentual: number): Centavos {
  return fixo ?? Math.round((base * (10_000 + percentual)) / 10_000)
}

/** Percentual para exibir: 800 → "8", 850 → "8,5". */
export function percentualParaTexto(p: number): string {
  return (p / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

/** Percentual digitado ("8", "8,5", "8.25") em centésimos de ponto; null se inválido. */
export function lerPercentual(texto: string): number | null {
  const m = /^(\d{1,3})(?:[,.](\d{1,2}))?$/.exec(texto.trim().replace(/%$/, ''))
  if (!m) return null
  const [, inteiro = '0', fracao = ''] = m
  return Number(inteiro) * 100 + Number(fracao.padEnd(2, '0'))
}

/**
 * Preço com atacarejo: levando `quantidadeTotal` do produto na venda e passando do mínimo,
 * vale o menor entre o preço de tabela e o de atacado.
 */
export function precoComAtacado(
  p: Pick<RegrasPreco, 'atacadoQuantidade' | 'atacadoPreco'>,
  tabela: Centavos,
  quantidadeTotal: Milesimos
): { preco: Centavos; atacado: boolean } {
  if (p.atacadoQuantidade !== null && p.atacadoPreco !== null && quantidadeTotal >= p.atacadoQuantidade && p.atacadoPreco < tabela) {
    return { preco: p.atacadoPreco, atacado: true }
  }
  return { preco: tabela, atacado: false }
}
