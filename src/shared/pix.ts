import type { Centavos } from './dinheiro'

/** Recebedor do Pix estático (QR gerado no próprio PDV, sem banco nem internet). */
export interface ConfigPix {
  chave: string
  /** Nome do recebedor (até 25 caracteres, sem acento). */
  nome: string
  /** Cidade do recebedor (até 15 caracteres, sem acento). */
  cidade: string
}

export const CONFIG_PIX_PADRAO: ConfigPix = { chave: '', nome: '', cidade: '' }

export type TipoChavePix = 'cpf' | 'cnpj' | 'telefone' | 'email' | 'aleatoria'

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), como pede o BR Code. */
export function crc16(texto: string): string {
  let crc = 0xffff
  for (const byte of new TextEncoder().encode(texto)) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

function digitoCpfCnpj(digitos: string, pesos: number[]): number {
  const soma = pesos.reduce((s, p, i) => s + p * Number(digitos[i]), 0)
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}

export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false
  const d1 = digitoCpfCnpj(cpf, [10, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = digitoCpfCnpj(cpf, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10])
}

export function cnpjValido(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1+$/.test(cnpj)) return false
  const d1 = digitoCpfCnpj(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = digitoCpfCnpj(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13])
}

/**
 * Normaliza a chave como o DICT espera: CPF/CNPJ só dígitos, telefone +55DDDNÚMERO,
 * e-mail e aleatória em minúsculas. Retorna null se não for uma chave válida.
 */
export function normalizarChavePix(entrada: string): { tipo: TipoChavePix; chave: string } | null {
  const t = entrada.trim()
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) {
    return { tipo: 'aleatoria', chave: t.toLowerCase() }
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return { tipo: 'email', chave: t.toLowerCase() }
  // Daqui em diante só números com a pontuação de CPF/CNPJ/telefone.
  if (!/^[\d\s()+.\-/]+$/.test(t)) return null
  const digitos = t.replace(/\D/g, '')
  if (!t.startsWith('+')) {
    if (digitos.length === 11 && cpfValido(digitos)) return { tipo: 'cpf', chave: digitos }
    if (digitos.length === 14 && cnpjValido(digitos)) return { tipo: 'cnpj', chave: digitos }
  }
  if (digitos.length === 10 || digitos.length === 11) return { tipo: 'telefone', chave: `+55${digitos}` }
  if (digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)) {
    return { tipo: 'telefone', chave: `+${digitos}` }
  }
  return null
}

/** Texto aceito no BR Code: sem acento, só ASCII imprimível, cortado no tamanho. */
export function textoBrCode(texto: string, max: number): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

const campo = (id: string, valor: string): string => `${id}${String(valor.length).padStart(2, '0')}${valor}`

/**
 * Payload "copia e cola" do Pix estático (BR Code / EMV MPM), com valor opcional e
 * identificador da transação (txid) para o recebedor reconhecer o pagamento.
 */
export function gerarBrCode(p: { chave: string; nome: string; cidade: string; valor: Centavos | null; txid?: string }): string {
  const txid = (p.txid ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', p.chave)
  const corpo =
    campo('00', '01') +
    campo('26', conta) +
    campo('52', '0000') +
    campo('53', '986') +
    (p.valor ? campo('54', (p.valor / 100).toFixed(2)) : '') +
    campo('58', 'BR') +
    campo('59', textoBrCode(p.nome, 25)) +
    campo('60', textoBrCode(p.cidade, 15)) +
    campo('62', campo('05', txid)) +
    '6304'
  return corpo + crc16(corpo)
}
