/**
 * Todo valor monetário é um inteiro em centavos. Nunca use float para dinheiro.
 * Quantidades são inteiros em milésimos (1 un = 1000; 0,350 kg = 350).
 */
export type Centavos = number
export type Milesimos = number

const formatador = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatarMoeda(valor: Centavos): string {
  return formatador.format(valor / 100)
}

/**
 * Converte texto digitado pelo operador em centavos.
 * Aceita "12", "12,5", "12,50", "1.234,56", "R$ 3,99". Retorna null se inválido.
 */
export function lerMoeda(texto: string): Centavos | null {
  const limpo = texto.replace(/R\$/i, '').replace(/\s/g, '')
  const m = /^(-)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(limpo)
  if (!m) return null
  const [, sinal, inteiro = '0', fracao = ''] = m
  const centavos = Number(inteiro.replace(/\./g, '')) * 100 + Number(fracao.padEnd(2, '0'))
  return sinal ? -centavos : centavos
}

/** Centavos no formato de campo editável: 1250 → "12,50". */
export function centavosParaTexto(valor: Centavos): string {
  const sinal = valor < 0 ? '-' : ''
  const abs = Math.abs(valor)
  return `${sinal}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

/**
 * Converte quantidade digitada em milésimos: "3" → 3000, "0,35" → 350, "1,250" → 1250.
 * Retorna null se inválida ou com mais de 3 casas.
 */
export function lerQuantidade(texto: string): Milesimos | null {
  const m = /^(-)?(\d+)(?:[,.](\d{1,3}))?$/.exec(texto.replace(/\s/g, ''))
  if (!m) return null
  const [, sinal, inteiro = '0', fracao = ''] = m
  const valor = Number(inteiro) * 1000 + Number(fracao.padEnd(3, '0'))
  return sinal ? -valor : valor
}

/** Milésimos para exibir: unidades sem casas quando inteiras ("3"), kg com 3 casas ("0,350"). */
export function quantidadeParaTexto(quantidade: Milesimos, unidade: 'UN' | 'KG'): string {
  const sinal = quantidade < 0 ? '-' : ''
  const abs = Math.abs(quantidade)
  const inteiro = Math.trunc(abs / 1000)
  const fracao = String(abs % 1000).padStart(3, '0')
  if (unidade === 'UN' && abs % 1000 === 0) return `${sinal}${inteiro}`
  return `${sinal}${inteiro},${unidade === 'UN' ? fracao.replace(/0+$/, '') : fracao}`
}

/** Total de um item: preço unitário × quantidade, arredondado ao centavo (meio para cima). */
export function totalItem(precoUnitario: Centavos, quantidade: Milesimos): Centavos {
  return Math.round((precoUnitario * quantidade) / 1000)
}
