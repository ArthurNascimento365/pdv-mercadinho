/** Documento a imprimir, independente da impressora: o main diagrama em colunas e gera ESC/POS. */
export type LinhaDocumento =
  | { tipo: 'texto'; texto: string; alinhamento?: 'esquerda' | 'centro' | 'direita'; negrito?: boolean; grande?: boolean }
  /** Texto à esquerda e valor encostado à direita (ex.: "TOTAL ........ 45,62"). */
  | { tipo: 'colunas'; esquerda: string; direita: string; negrito?: boolean; grande?: boolean }
  | { tipo: 'separador'; caractere?: string }
  | { tipo: 'espaco' }
  /** QR Code centralizado (a impressora desenha: comando nativo GS ( k). */
  | { tipo: 'qrcode'; conteudo: string }

export type Documento = LinhaDocumento[]

/** Linha já pronta para a bobina: texto com a largura exata da impressora. */
export interface LinhaDiagramada {
  texto: string
  negrito: boolean
  grande: boolean
  /** Presente = a linha é um QR Code com este conteúdo (texto vazio). */
  qr?: string
}

export interface Diagramado {
  colunas: number
  linhas: LinhaDiagramada[]
}

export type ModoImpressora = 'nenhuma' | 'windows' | 'rede' | 'serial' | 'driver'

export const MODOS_IMPRESSORA: Record<ModoImpressora, string> = {
  nenhuma: 'Sem impressora',
  windows: 'Impressora do Windows (ESC/POS direto, recomendado)',
  rede: 'Impressora de rede (IP, porta 9100)',
  serial: 'Porta serial (COM)',
  driver: 'Driver do Windows (qualquer impressora, sem gaveta)'
}

export interface ConfigImpressora {
  modo: ModoImpressora
  /** Nome da impressora no Windows (modos windows e driver). */
  nome: string
  host: string
  porta: number
  serial: string
  baud: number
  /** Caracteres por linha: 48 (80 mm), 42 (80 mm fonte maior) ou 32 (58 mm). */
  colunas: 32 | 42 | 48
  /** Tabela de caracteres da impressora; "sem" tira os acentos. */
  acentos: 'cp850' | 'cp860' | 'sem'
  cortar: boolean
  gaveta: 'nao' | 'pino2' | 'pino5'
  imprimirAutomatico: boolean
  /** Linhas extras do cabeçalho (CNPJ, endereço, telefone), uma por linha. */
  cabecalho: string
  rodape: string
}

export const CONFIG_IMPRESSORA_PADRAO: ConfigImpressora = {
  modo: 'nenhuma',
  nome: '',
  host: '',
  porta: 9100,
  serial: '',
  baud: 9600,
  colunas: 48,
  acentos: 'cp850',
  cortar: true,
  gaveta: 'pino2',
  imprimirAutomatico: true,
  cabecalho: '',
  rodape: 'Obrigado pela preferência!'
}

export interface ConfigBalancaSerial {
  modo: 'nenhuma' | 'serial'
  porta: string
  baud: 2400 | 4800 | 9600
}

export const CONFIG_BALANCA_PADRAO: ConfigBalancaSerial = { modo: 'nenhuma', porta: '', baud: 9600 }

export type LeituraBalanca =
  | { ok: true; gramas: number }
  | { ok: false; motivo: 'instavel' | 'negativo' | 'sobrecarga' | 'sem-resposta' | 'invalida' | 'desligada' }

export const MOTIVOS_BALANCA: Record<Exclude<LeituraBalanca, { ok: true }>['motivo'], string> = {
  instavel: 'Peso instável: espere o prato parar.',
  negativo: 'Peso negativo: confira a tara da balança.',
  sobrecarga: 'Peso acima da capacidade da balança.',
  'sem-resposta': 'A balança não respondeu. Confira o cabo e a porta.',
  invalida: 'Resposta da balança não reconhecida.',
  desligada: 'Leitura da balança não configurada.'
}

export interface PortaSerialInfo {
  caminho: string
  nome: string
}

/** Resultado de imprimir/abrir gaveta depois da venda: nunca bloqueia a venda. */
export interface ResultadoHardware {
  impresso: boolean
  gaveta: boolean
  erro: string | null
}
