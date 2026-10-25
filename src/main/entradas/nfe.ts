import { XMLParser } from 'fast-xml-parser'
import { eanValido } from '@shared/ean'
import type { ItemNota, LoteNota, NotaFiscal } from '@shared/estoque'
import { limparEspacos } from '@shared/texto'
import { ErroNegocio } from '../erros'

type No = Record<string, unknown>

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  // Tudo como texto: EAN e código com zero à esquerda não podem virar número.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (nome) => nome === 'det' || nome === 'rastro'
})

function no(valor: unknown): No | undefined {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor) ? (valor as No) : undefined
}

function texto(pai: No | undefined, campo: string): string | null {
  const v = pai?.[campo]
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number') return String(v)
  return null
}

function exigir(pai: No | undefined, campo: string): string {
  const v = texto(pai, campo)
  if (v === null) throw new ErroNegocio(`NF-e incompleta: falta <${campo}>`)
  return v
}

/** "12.3456" com 4 casas → 123456. Casas a mais são arredondadas (meio para cima). */
export function decimalParaInteiro(valor: string | null, casas: number): number {
  if (valor === null) return 0
  const m = /^(\d+)(?:\.(\d+))?$/.exec(valor)
  if (!m) throw new ErroNegocio(`Número inválido na NF-e: "${valor}"`)
  const [, inteiro = '0', fracao = ''] = m
  const base = Number(inteiro) * 10 ** casas + Number(fracao.slice(0, casas).padEnd(casas, '0'))
  return fracao.length > casas && Number(fracao[casas]) >= 5 ? base + 1 : base
}

const centavos = (pai: No | undefined, campo: string): number => decimalParaInteiro(texto(pai, campo), 2)

function ean(valor: string | null): string | null {
  return valor && eanValido(valor) ? valor : null
}

/** O grupo de ICMS vem como ICMS00, ICMS10, ICMSSN202...: pega o que existir. */
function grupoIcms(imposto: No | undefined): No | undefined {
  const icms = no(imposto?.['ICMS'])
  return icms ? no(Object.values(icms)[0]) : undefined
}

function lerItem(det: No): ItemNota {
  const prod = no(det['prod'])
  const imposto = no(det['imposto'])
  const ipi = no(no(imposto?.['IPI'])?.['IPITrib'])

  const custoTotal =
    centavos(prod, 'vProd') -
    centavos(prod, 'vDesc') +
    centavos(prod, 'vFrete') +
    centavos(prod, 'vSeg') +
    centavos(prod, 'vOutro') +
    centavos(ipi, 'vIPI') +
    centavos(grupoIcms(imposto), 'vICMSST')

  const rastros = Array.isArray(prod?.['rastro']) ? (prod['rastro'] as unknown[]) : []
  const lotes: LoteNota[] = rastros
    .map(no)
    .filter((r): r is No => !!r)
    .map((r) => ({ lote: texto(r, 'nLote') ?? '', validade: texto(r, 'dVal') }))
    .filter((l) => l.lote || l.validade)

  return {
    numero: Number(det['@nItem'] ?? 0),
    codigo: exigir(prod, 'cProd'),
    ean: ean(texto(prod, 'cEAN')),
    eanTributavel: ean(texto(prod, 'cEANTrib')),
    descricao: limparEspacos(exigir(prod, 'xProd')).slice(0, 120),
    unidade: (texto(prod, 'uCom') ?? 'UN').toUpperCase(),
    quantidade: decimalParaInteiro(exigir(prod, 'qCom'), 4),
    unidadeTributavel: (texto(prod, 'uTrib') ?? texto(prod, 'uCom') ?? 'UN').toUpperCase(),
    quantidadeTributavel: decimalParaInteiro(texto(prod, 'qTrib') ?? exigir(prod, 'qCom'), 4),
    custoTotal: Math.max(0, custoTotal),
    lotes
  }
}

/** Lê o XML de uma NF-e (com ou sem o envelope nfeProc). */
export function lerNfe(xml: string): NotaFiscal {
  let raiz: No
  try {
    raiz = parser.parse(xml) as No
  } catch {
    throw new ErroNegocio('Arquivo não é um XML válido')
  }
  if (raiz['procEventoNFe'] || raiz['evento']) {
    throw new ErroNegocio('Este XML é de um evento (cancelamento ou carta de correção), não da nota')
  }

  const nfe = no(no(raiz['nfeProc'])?.['NFe']) ?? no(raiz['NFe'])
  const inf = no(nfe?.['infNFe'])
  if (!inf) throw new ErroNegocio('Arquivo não é o XML de uma NF-e')

  const id = typeof inf['@Id'] === 'string' ? inf['@Id'] : ''
  const chave = id.replace(/^NFe/, '')
  if (!/^\d{44}$/.test(chave)) throw new ErroNegocio('NF-e sem chave de acesso válida')

  const ide = no(inf['ide'])
  const emit = no(inf['emit'])
  const cnpj = texto(emit, 'CNPJ') ?? texto(emit, 'CPF')
  if (!cnpj) throw new ErroNegocio('NF-e sem CNPJ do emitente')

  const dets = Array.isArray(inf['det']) ? (inf['det'] as unknown[]) : []
  const itens = dets.map(no).filter((d): d is No => !!d).map(lerItem)
  if (itens.length === 0) throw new ErroNegocio('NF-e sem itens')

  return {
    chave,
    numero: Number(exigir(ide, 'nNF')),
    serie: Number(texto(ide, 'serie') ?? 0),
    emissao: texto(ide, 'dhEmi') ?? texto(ide, 'dEmi') ?? '',
    emitente: {
      cnpj,
      razaoSocial: limparEspacos(exigir(emit, 'xNome')),
      nomeFantasia: texto(emit, 'xFant'),
      telefone: texto(no(emit?.['enderEmit']), 'fone')
    },
    valorTotal: centavos(no(no(inf['total'])?.['ICMSTot']), 'vNF'),
    itens
  }
}
