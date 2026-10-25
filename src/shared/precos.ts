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
