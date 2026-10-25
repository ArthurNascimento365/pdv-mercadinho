import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import {
  CONFIG_BACKUP_PADRAO,
  type ArquivoBackup,
  type ConfigBackup,
  type DestinoBackup,
  type InfoBackupValido,
  type MotivoBackup,
  type ResultadoBackup
} from '@shared/backup'
import type { Banco } from '../db/conexao'
import { MIGRACOES } from '../db/migracoes'
import { ErroNegocio } from '../erros'
import { definirConfig, obterConfig } from '../repos/configuracoes'

/** pdv-2026-10-19_073512.db — data/hora local, ordem alfabética = ordem cronológica. */
const PADRAO = /^pdv-(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})\.db$/

const doisDigitos = (n: number): string => String(n).padStart(2, '0')

export function nomeArquivo(d: Date, sufixo = ''): string {
  const data = `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`
  const hora = `${doisDigitos(d.getHours())}${doisDigitos(d.getMinutes())}${doisDigitos(d.getSeconds())}`
  return `pdv-${data}_${hora}${sufixo}.db`
}

function dataDoNome(nome: string): Date | null {
  const m = PADRAO.exec(nome)
  if (!m) return null
  const [, a, me, d, h, mi, s] = m.map(Number) as number[]
  return new Date(a!, me! - 1, d!, h!, mi!, s!)
}

/** Semana ISO ("2026-W42"), para a rotação semanal. */
function semana(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const diaSemana = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - diaSemana)
  const inicioAno = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const numero = Math.ceil(((t.getTime() - inicioAno.getTime()) / 86_400_000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${numero}`
}

/**
 * Rotação: o mais recente de cada um dos 7 últimos dias com backup e o mais recente de
 * cada uma das 4 últimas semanas. Arquivos fora do padrão (ex.: "antes de restaurar") ficam.
 */
export function escolherParaApagar(nomes: string[]): string[] {
  const datados = nomes
    .map((nome) => ({ nome, data: dataDoNome(nome) }))
    .filter((a): a is { nome: string; data: Date } => a.data !== null)
    .sort((a, b) => (a.nome < b.nome ? 1 : -1))

  const manter = new Set<string>()
  const dias = new Set<string>()
  const semanas = new Set<string>()
  for (const a of datados) {
    const dia = a.nome.slice(4, 14)
    if (!dias.has(dia) && dias.size < 7) {
      dias.add(dia)
      manter.add(a.nome)
    }
    const s = semana(a.data)
    if (!semanas.has(s) && semanas.size < 4) {
      semanas.add(s)
      manter.add(a.nome)
    }
  }
  return datados.filter((a) => !manter.has(a.nome)).map((a) => a.nome)
}

function rotacionar(pasta: string): void {
  for (const nome of escolherParaApagar(readdirSync(pasta))) rmSync(join(pasta, nome), { force: true })
}

/** Abre o arquivo só para leitura e confere integridade e estrutura. Lança se não servir. */
export function validarArquivo(caminho: string): InfoBackupValido {
  if (!existsSync(caminho)) throw new ErroNegocio('Arquivo de backup não encontrado')
  let db: DatabaseSync
  try {
    db = new DatabaseSync(caminho, { readOnly: true })
  } catch {
    throw new ErroNegocio('O arquivo não é um banco de dados do PDV')
  }
  try {
    let integridade: string
    try {
      integridade = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check
    } catch {
      throw new ErroNegocio('O arquivo não é um banco de dados do PDV')
    }
    if (integridade !== 'ok') throw new ErroNegocio(`Backup corrompido: ${integridade}`)

    const versao = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (versao < 1) throw new ErroNegocio('O arquivo não é um banco de dados do PDV')
    if (versao > MIGRACOES.length) {
      throw new ErroNegocio('Backup feito por uma versão mais nova do PDV. Atualize o programa antes de restaurar.')
    }
    const tabelas = new Set(
      (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name)
    )
    if (!tabelas.has('configuracoes')) throw new ErroNegocio('O arquivo não é um banco de dados do PDV')
    const contar = (tabela: string): number =>
      tabelas.has(tabela) ? (db.prepare(`SELECT count(*) AS n FROM ${tabela}`).get() as { n: number }).n : 0
    const ultimaVenda = tabelas.has('vendas')
      ? ((db.prepare(`SELECT max(finalizada_em) AS d FROM vendas`).get() as { d: string | null }).d ?? null)
      : null
    return { caminho, versaoSchema: versao, produtos: contar('produtos'), vendas: contar('vendas'), ultimaVenda }
  } finally {
    db.close()
  }
}

export function listarBackups(pasta: string): ArquivoBackup[] {
  if (!existsSync(pasta)) return []
  return readdirSync(pasta)
    .filter((n) => n.startsWith('pdv-') && n.endsWith('.db'))
    .map((nome) => {
      const caminho = join(pasta, nome)
      const st = statSync(caminho)
      return { nome, caminho, data: (dataDoNome(nome) ?? st.mtime).toISOString(), tamanho: st.size }
    })
    .sort((a, b) => (a.data < b.data ? 1 : -1))
}

export function obterConfigBackup(db: Banco): ConfigBackup {
  try {
    return { ...CONFIG_BACKUP_PADRAO, ...(JSON.parse(obterConfig(db, 'backup') ?? '{}') as Partial<ConfigBackup>) }
  } catch {
    return { ...CONFIG_BACKUP_PADRAO }
  }
}

export function salvarConfigBackup(db: Banco, dado: unknown): ConfigBackup {
  const d = (dado ?? {}) as Partial<ConfigBackup>
  if (!Array.isArray(d.pastasExtras) || d.pastasExtras.some((p) => typeof p !== 'string' || p.length > 500)) {
    throw new ErroNegocio('Pastas de backup inválidas')
  }
  if (!Number.isInteger(d.intervaloHoras) || d.intervaloHoras! < 1 || d.intervaloHoras! > 24) {
    throw new ErroNegocio('Intervalo deve ser de 1 a 24 horas')
  }
  const cfg: ConfigBackup = {
    pastasExtras: [...new Set(d.pastasExtras.map((p) => p.trim()).filter(Boolean))].slice(0, 5),
    intervaloHoras: d.intervaloHoras!
  }
  definirConfig(db, 'backup', JSON.stringify(cfg))
  return cfg
}

export function ultimoBackup(db: Banco): ResultadoBackup | null {
  try {
    return JSON.parse(obterConfig(db, 'backup.ultimo') ?? 'null') as ResultadoBackup | null
  } catch {
    return null
  }
}

export class ServicoBackup {
  private emAndamento: Promise<ResultadoBackup> | null = null

  constructor(
    private readonly db: Banco,
    private readonly caminhoBanco: string,
    readonly pastaPrincipal: string,
    /** Fecha o app e abre de novo (no teste, só registra). */
    private readonly reiniciar: () => void
  ) {}

  /**
   * Copia o banco em uso pela API de backup do SQLite (não para o caixa), valida a cópia,
   * replica nas pastas extras e aplica a rotação. Backups simultâneos viram um só.
   */
  fazer(motivo: MotivoBackup): Promise<ResultadoBackup> {
    this.emAndamento ??= this.executar(motivo).finally(() => {
      this.emAndamento = null
    })
    return this.emAndamento
  }

  private async executar(motivo: MotivoBackup): Promise<ResultadoBackup> {
    const agora = new Date()
    const nome = nomeArquivo(agora, motivo === 'antes-de-restaurar' ? '-antes-de-restaurar' : '')
    const destinos: DestinoBackup[] = []
    const principal = join(this.pastaPrincipal, nome)

    try {
      mkdirSync(this.pastaPrincipal, { recursive: true })
      const parcial = `${principal}.parcial`
      await backup(this.db, parcial)
      validarArquivo(parcial)
      renameSync(parcial, principal)
      rotacionar(this.pastaPrincipal)
      destinos.push({ pasta: this.pastaPrincipal, ok: true, erro: null })
    } catch (e) {
      destinos.push({ pasta: this.pastaPrincipal, ok: false, erro: e instanceof Error ? e.message : String(e) })
    }

    for (const pasta of obterConfigBackup(this.db).pastasExtras) {
      try {
        if (!destinos[0]!.ok) throw new Error('backup principal falhou')
        // Não cria a pasta: pendrive fora = destino indisponível, não uma pasta nova no C:.
        if (!existsSync(pasta)) throw new Error('pasta não encontrada (pendrive desconectado?)')
        copyFileSync(principal, join(pasta, nome))
        rotacionar(pasta)
        destinos.push({ pasta, ok: true, erro: null })
      } catch (e) {
        destinos.push({ pasta, ok: false, erro: e instanceof Error ? e.message : String(e) })
      }
    }

    const resultado: ResultadoBackup = { quando: agora.toISOString(), motivo, arquivo: nome, destinos, ok: destinos[0]!.ok }
    if (motivo !== 'antes-de-restaurar') definirConfig(this.db, 'backup.ultimo', JSON.stringify(resultado))
    return resultado
  }

  /** Hora de fazer o automático? */
  devido(agora = new Date()): boolean {
    const ultimo = ultimoBackup(this.db)
    if (!ultimo?.ok) return true
    const horas = obterConfigBackup(this.db).intervaloHoras
    return agora.getTime() - new Date(ultimo.quando).getTime() >= horas * 3600 * 1000
  }

  /**
   * Troca o banco pelo backup: valida, guarda uma cópia do estado atual ("antes de
   * restaurar"), fecha o banco, copia e reinicia o PDV.
   */
  async restaurar(caminho: string): Promise<void> {
    const venda = this.db.prepare(`SELECT id FROM vendas WHERE status = 'aberta'`).get() as { id: number } | undefined
    if (venda) throw new ErroNegocio(`Finalize ou cancele a venda nº ${venda.id} antes de restaurar`)
    validarArquivo(caminho)
    if (basename(caminho) === basename(this.caminhoBanco)) throw new ErroNegocio('Escolha um arquivo de backup')

    const seguranca = await this.fazer('antes-de-restaurar')
    if (!seguranca.ok) throw new ErroNegocio('Não deu para guardar o estado atual antes de restaurar. Nada foi alterado.')

    this.db.close()
    for (const extra of ['-wal', '-shm']) rmSync(`${this.caminhoBanco}${extra}`, { force: true })
    copyFileSync(caminho, this.caminhoBanco)
    this.reiniciar()
  }
}
