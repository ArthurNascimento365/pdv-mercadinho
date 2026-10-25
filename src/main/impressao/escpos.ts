import type { ConfigImpressora, Diagramado } from '@shared/impressao'

const ESC = 0x1b
const GS = 0x1d

/** Tabelas de caracteres ESC/POS (só o que aparece em português). */
const CP850: Record<string, number> = {
  Ç: 0x80, ü: 0x81, é: 0x82, â: 0x83, à: 0x85, ç: 0x87, ê: 0x88, è: 0x8a, í: 0xa1, ô: 0x93,
  Ü: 0x9a, á: 0xa0, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, ª: 0xa6, º: 0xa7, É: 0x90, Á: 0xb5,
  Â: 0xb6, À: 0xb7, ã: 0xc6, Ã: 0xc7, Ê: 0xd2, Í: 0xd6, Ó: 0xe0, Ô: 0xe2, õ: 0xe4, Õ: 0xe5,
  Ú: 0xe9, '°': 0xf8, '·': 0xfa
}

const CP860: Record<string, number> = {
  Ç: 0x80, ü: 0x81, é: 0x82, â: 0x83, ã: 0x84, à: 0x85, Á: 0x86, ç: 0x87, ê: 0x88, Ê: 0x89,
  è: 0x8a, Í: 0x8b, Ô: 0x8c, Ã: 0x8e, Â: 0x8f, É: 0x90, À: 0x91, ô: 0x93, õ: 0x94, Ú: 0x96,
  Õ: 0x99, Ü: 0x9a, Ó: 0x9f, á: 0xa0, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, ª: 0xa6,
  º: 0xa7, '°': 0xf8, '·': 0xfa
}

/** Número da tabela no comando ESC t n. */
const NUMERO_TABELA = { cp850: 2, cp860: 3, sem: 2 } as const

/** Converte o texto para os bytes da tabela; o que não existir nela perde o acento (ou vira "?"). */
export function codificar(texto: string, acentos: ConfigImpressora['acentos']): number[] {
  const tabela = acentos === 'cp860' ? CP860 : acentos === 'cp850' ? CP850 : {}
  const bytes: number[] = []
  for (const ch of texto.replace(/ /g, ' ')) {
    const codigo = ch.charCodeAt(0)
    if (codigo >= 0x20 && codigo < 0x7f) bytes.push(codigo)
    else if (tabela[ch] !== undefined) bytes.push(tabela[ch])
    else {
      const semAcento = ch.normalize('NFD').replace(/\p{M}/gu, '')
      const c = semAcento.charCodeAt(0)
      bytes.push(semAcento.length > 0 && c >= 0x20 && c < 0x7f ? c : 0x3f)
    }
  }
  return bytes
}

/** Pulso para abrir a gaveta ligada à impressora (ESC p m t1 t2). */
export function comandoGaveta(pino: 'pino2' | 'pino5'): number[] {
  return [ESC, 0x70, pino === 'pino2' ? 0 : 1, 25, 250]
}

/**
 * Gera os bytes ESC/POS. Alinhamento já vem resolvido na diagramação (espaços), então só
 * negrito e tamanho duplo viram comando. A gaveta, se pedida, abre antes de imprimir.
 */
export function gerarEscPos(
  d: Diagramado,
  cfg: Pick<ConfigImpressora, 'acentos' | 'cortar'>,
  { abrirGaveta = null }: { abrirGaveta?: 'pino2' | 'pino5' | null } = {}
): Uint8Array {
  const b: number[] = [ESC, 0x40, ESC, 0x74, NUMERO_TABELA[cfg.acentos]]
  if (abrirGaveta) b.push(...comandoGaveta(abrirGaveta))

  for (const l of d.linhas) {
    if (l.qr !== undefined) {
      b.push(...comandoQr(l.qr))
      continue
    }
    if (l.negrito) b.push(ESC, 0x45, 1)
    if (l.grande) b.push(GS, 0x21, 0x11)
    b.push(...codificar(l.texto.trimEnd(), cfg.acentos), 0x0a)
    if (l.grande) b.push(GS, 0x21, 0x00)
    if (l.negrito) b.push(ESC, 0x45, 0)
  }

  b.push(ESC, 0x64, 4) // avança 4 linhas para o texto passar da guilhotina
  if (cfg.cortar) b.push(GS, 0x56, 0x42, 0) // corte parcial
  return Uint8Array.from(b)
}

/**
 * QR Code nativo da impressora (GS ( k, modelo 2, módulo 6, correção M), centralizado.
 * O conteúdo do Pix é ASCII, então vai byte a byte.
 */
export function comandoQr(conteudo: string): number[] {
  const dados = [...Buffer.from(conteudo, 'latin1')]
  const n = dados.length + 3
  return [
    ESC, 0x61, 1, // centraliza
    GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0, // modelo 2
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, 6, // tamanho do módulo
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31, // correção de erro M
    GS, 0x28, 0x6b, n & 0xff, n >> 8, 0x31, 0x50, 0x30, ...dados, // guarda
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30, // imprime
    0x0a,
    ESC, 0x61, 0 // volta à esquerda
  ]
}

/** Só a gaveta, sem imprimir nada. */
export function bytesSoGaveta(pino: 'pino2' | 'pino5'): Uint8Array {
  return Uint8Array.from([ESC, 0x40, ...comandoGaveta(pino)])
}
