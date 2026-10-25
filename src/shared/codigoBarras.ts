import { eanValido } from './ean'

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
/** Paridade dos 6 dígitos da esquerda do EAN-13, definida pelo primeiro dígito. */
const PARIDADE = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLG', 'LGLGLG', 'LGLGGL', 'LGGLGL']

const d = (c: string): number => c.charCodeAt(0) - 48

/**
 * Barras de um EAN-13 (95 módulos), UPC-A (vira EAN-13 com 0 na frente) ou EAN-8 (67),
 * como texto de "1" (barra) e "0" (espaço). null para código que não é EAN-8/12/13 válido.
 */
export function modulosEan(codigo: string): string | null {
  if (!eanValido(codigo)) return null
  if (codigo.length === 8) {
    const esq = codigo.slice(0, 4).split('').map((c) => L[d(c)]).join('')
    const dir = codigo.slice(4).split('').map((c) => R[d(c)]).join('')
    return `101${esq}01010${dir}101`
  }
  const ean13 = codigo.length === 12 ? `0${codigo}` : codigo
  if (ean13.length !== 13) return null
  const paridade = PARIDADE[d(ean13[0]!)]!
  const esq = ean13
    .slice(1, 7)
    .split('')
    .map((c, i) => (paridade[i] === 'L' ? L : G)[d(c)])
    .join('')
  const dir = ean13.slice(7).split('').map((c) => R[d(c)]).join('')
  return `101${esq}01010${dir}101`
}

/** SVG do código de barras (as barras de guarda descem um pouco, como no padrão). */
export function svgEan(codigo: string, { largura = 38, altura = 12 } = {}): string | null {
  const modulos = modulosEan(codigo)
  if (!modulos) return null
  const n = modulos.length
  const guardas = new Set<number>()
  const marcar = (inicio: number, tam: number): void => {
    for (let i = inicio; i < inicio + tam; i++) guardas.add(i)
  }
  marcar(0, 3)
  marcar(Math.floor(n / 2) - 2, 5)
  marcar(n - 3, 3)
  const barras: string[] = []
  for (let i = 0; i < n; i++) {
    if (modulos[i] === '1') barras.push(`<rect x="${i}" y="0" width="1" height="${guardas.has(i) ? 54 : 50}"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} 64" width="${largura}mm" height="${altura}mm" preserveAspectRatio="none">${barras.join('')}<text x="${n / 2}" y="63" font-size="9" text-anchor="middle" font-family="monospace">${codigo}</text></svg>`
}
