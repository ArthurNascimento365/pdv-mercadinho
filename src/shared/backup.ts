export interface ConfigBackup {
  /** Pastas extras além da principal: pendrive, pasta do Google Drive/OneDrive... */
  pastasExtras: string[]
  intervaloHoras: number
}

export const CONFIG_BACKUP_PADRAO: ConfigBackup = { pastasExtras: [], intervaloHoras: 4 }

export type MotivoBackup = 'automatico' | 'fechamento' | 'manual' | 'antes-de-restaurar'

export interface DestinoBackup {
  pasta: string
  ok: boolean
  erro: string | null
}

export interface ResultadoBackup {
  quando: string
  motivo: MotivoBackup
  arquivo: string
  /** A primeira é sempre a pasta principal. */
  destinos: DestinoBackup[]
  /** Backup válido na pasta principal. */
  ok: boolean
}

export interface ArquivoBackup {
  nome: string
  caminho: string
  data: string
  tamanho: number
}

export interface InfoBackupValido {
  caminho: string
  versaoSchema: number
  produtos: number
  vendas: number
  ultimaVenda: string | null
}

export interface EstadoBackup {
  config: ConfigBackup
  pastaPrincipal: string
  ultimo: ResultadoBackup | null
  arquivos: ArquivoBackup[]
}

/** Backup em dia = último deu certo há menos de 24 h. */
export function backupAtrasado(ultimo: ResultadoBackup | null, agora = new Date()): boolean {
  if (!ultimo?.ok) return true
  return agora.getTime() - new Date(ultimo.quando).getTime() > 24 * 3600 * 1000
}
