import { digitoVerificador } from './ean'

/**
 * Etiqueta de balança (Toledo, Filizola, Urano...): EAN-13 começando com "2".
 *   2 | código do produto (4 a 6 dígitos) | valor (o resto até o 12º dígito) | DV
 * Ex.: 4 dígitos de código → 2 CCCC VVVVVVV D. O valor é o preço total em centavos
 * ou o peso em gramas, conforme a balança foi programada.
 */
export interface FormatoBalanca {
  digitosCodigo: 4 | 5 | 6
  tipoValor: 'preco' | 'peso'
}

export const FORMATO_BALANCA_PADRAO: FormatoBalanca = { digitosCodigo: 4, tipoValor: 'preco' }

export interface EtiquetaBalanca {
  codigoProduto: number
  /** Centavos (tipoValor "preco") ou gramas (tipoValor "peso"). */
  valor: number
}

export function lerEtiquetaBalanca(codigo: string, formato: FormatoBalanca): EtiquetaBalanca | null {
  if (!/^2\d{12}$/.test(codigo)) return null
  if (digitoVerificador(codigo.slice(0, 12)) !== Number(codigo[12])) return null
  const fimCodigo = 1 + formato.digitosCodigo
  return {
    codigoProduto: Number(codigo.slice(1, fimCodigo)),
    valor: Number(codigo.slice(fimCodigo, 12))
  }
}

/** Monta uma etiqueta válida (usado em testes e na tela de configuração). */
export function montarEtiquetaBalanca(etiqueta: EtiquetaBalanca, formato: FormatoBalanca): string {
  const digitosValor = 11 - formato.digitosCodigo
  const corpo =
    '2' +
    String(etiqueta.codigoProduto).padStart(formato.digitosCodigo, '0') +
    String(etiqueta.valor).padStart(digitosValor, '0')
  if (corpo.length !== 12) throw new Error('Código ou valor grande demais para o formato da balança')
  return corpo + digitoVerificador(corpo)
}
