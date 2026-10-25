/** GTIN aceitos: EAN-8, UPC-A (12), EAN-13 e DUN-14. */
const TAMANHOS_GTIN = new Set([8, 12, 13, 14])

/** Dígito verificador GTIN (módulo 10, pesos 3 e 1 a partir da direita) de um código sem o dígito. */
export function digitoVerificador(corpo: string): number {
  let soma = 0
  for (let i = 0; i < corpo.length; i++) {
    const digito = corpo.charCodeAt(corpo.length - 1 - i) - 48
    soma += digito * (i % 2 === 0 ? 3 : 1)
  }
  return (10 - (soma % 10)) % 10
}

export function eanValido(codigo: string): boolean {
  if (!/^\d+$/.test(codigo) || !TAMANHOS_GTIN.has(codigo.length)) return false
  return digitoVerificador(codigo.slice(0, -1)) === Number(codigo.at(-1))
}

/** Tira espaços e pontuação que leitores ou planilhas às vezes acrescentam. */
export function limparCodigo(codigo: string): string {
  return codigo.replace(/[\s.\-]/g, '')
}
