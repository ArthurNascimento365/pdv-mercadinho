import QRCode from 'qrcode'
import { CONFIG_PIX_PADRAO, gerarBrCode, normalizarChavePix, textoBrCode, type ConfigPix } from '@shared/pix'
import type { Banco } from './db/conexao'
import { ErroNegocio } from './erros'
import { definirConfig, obterConfig } from './repos/configuracoes'

export function obterConfigPix(db: Banco): ConfigPix {
  try {
    return { ...CONFIG_PIX_PADRAO, ...(JSON.parse(obterConfig(db, 'pix') ?? '{}') as Partial<ConfigPix>) }
  } catch {
    return { ...CONFIG_PIX_PADRAO }
  }
}

export function salvarConfigPix(db: Banco, dado: unknown): ConfigPix {
  const d = (dado ?? {}) as Partial<Record<keyof ConfigPix, unknown>>
  const texto = (v: unknown): string => (typeof v === 'string' ? v : '')
  if (!texto(d.chave).trim() && !texto(d.nome).trim() && !texto(d.cidade).trim()) {
    definirConfig(db, 'pix', JSON.stringify(CONFIG_PIX_PADRAO))
    return { ...CONFIG_PIX_PADRAO }
  }
  const chave = normalizarChavePix(texto(d.chave))
  if (!chave) throw new ErroNegocio('Chave Pix inválida (CPF, CNPJ, telefone, e-mail ou chave aleatória)')
  const nome = textoBrCode(texto(d.nome), 25)
  const cidade = textoBrCode(texto(d.cidade), 15)
  if (!nome) throw new ErroNegocio('Informe o nome do recebedor do Pix')
  if (!cidade) throw new ErroNegocio('Informe a cidade do recebedor do Pix')
  const cfg = { chave: chave.chave, nome, cidade }
  definirConfig(db, 'pix', JSON.stringify(cfg))
  return cfg
}

/** Payload do Pix com o valor da venda; null se o Pix não estiver configurado. */
export function payloadPix(db: Banco, valor: unknown, vendaId: unknown): string | null {
  const cfg = obterConfigPix(db)
  if (!cfg.chave) return null
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor <= 0) throw new ErroNegocio('Valor do Pix inválido')
  const txid = typeof vendaId === 'number' && Number.isSafeInteger(vendaId) ? `PDV${vendaId}` : undefined
  return gerarBrCode({ ...cfg, valor, txid })
}

export async function gerarPix(db: Banco, valor: unknown, vendaId: unknown): Promise<{ payload: string; svg: string } | null> {
  const payload = payloadPix(db, valor, vendaId)
  if (!payload) return null
  const svg = await QRCode.toString(payload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
  return { payload, svg }
}
