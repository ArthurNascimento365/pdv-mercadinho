import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backupAtrasado } from '@shared/backup'
import {
  escolherParaApagar,
  listarBackups,
  nomeArquivo,
  salvarConfigBackup,
  ServicoBackup,
  ultimoBackup,
  validarArquivo
} from '../../src/main/backup/backup'
import { abrirBanco, type Banco } from '../../src/main/db/conexao'
import { criarProduto } from '../../src/main/repos/produtos'
import { entrada } from '../ajuda'

describe('rotação', () => {
  const nome = (dia: number, hora = 12, mes = 10) => nomeArquivo(new Date(2026, mes - 1, dia, hora, 0, 0))

  it('nome com data e hora local', () => {
    expect(nomeArquivo(new Date(2026, 9, 5, 7, 3, 9))).toBe('pdv-2026-10-05_070309.db')
  })

  it('guarda o último de cada um dos 7 dias e o último de cada uma das 4 semanas', () => {
    // 40 dias de backup, 3 por dia (8h, 12h, 16h): de 10/09 a 19/10/2026.
    const nomes: string[] = []
    for (let i = 0; i < 40; i++) {
      for (const h of [8, 12, 16]) nomes.push(nomeArquivo(new Date(2026, 8, 10 + i, h)))
    }
    const apagar = new Set(escolherParaApagar(nomes))
    const ficam = nomes.filter((n) => !apagar.has(n)).sort().reverse()

    // 7 dias: 13 a 19/10, só o das 16h.
    for (let d = 13; d <= 19; d++) expect(ficam).toContain(nome(d, 16))
    expect(ficam).not.toContain(nome(19, 8))
    // 19/10/2026 é segunda: as 4 semanas são a atual (19), 12–18, 05–11 e 28/09–04/10.
    // O último de cada uma: 19 e 18 (já entram nos diários), 11/10 e 04/10.
    expect(ficam).toContain(nome(11, 16))
    expect(ficam).toContain(nome(4, 16))
    expect(ficam).not.toContain(nomeArquivo(new Date(2026, 8, 27, 16)))
    expect(ficam).toHaveLength(7 + 2)
  })

  it('não mexe em arquivos fora do padrão', () => {
    expect(escolherParaApagar(['pdv-2026-10-01_120000-antes-de-restaurar.db', 'outra-coisa.txt'])).toEqual([])
  })
})

describe('ServicoBackup', () => {
  let pasta: string
  let db: Banco
  let reiniciou: number

  beforeEach(() => {
    pasta = mkdtempSync(join(tmpdir(), 'pdv-bkp-'))
    db = abrirBanco(join(pasta, 'pdv.db'))
    criarProduto(db, entrada({ descricao: 'Arroz' }))
    reiniciou = 0
  })
  afterEach(() => {
    try {
      db.close()
    } catch {
      // já fechado pela restauração
    }
    rmSync(pasta, { recursive: true, force: true })
  })

  const servico = () => new ServicoBackup(db, join(pasta, 'pdv.db'), join(pasta, 'backups'), () => reiniciou++)

  it('faz, valida e registra o último backup', async () => {
    const r = await servico().fazer('manual')
    expect(r.ok).toBe(true)
    expect(r.destinos).toEqual([{ pasta: join(pasta, 'backups'), ok: true, erro: null }])
    const [arquivo] = listarBackups(join(pasta, 'backups'))
    expect(validarArquivo(arquivo!.caminho)).toMatchObject({ produtos: 1, vendas: 0 })
    expect(ultimoBackup(db)?.arquivo).toBe(r.arquivo)
    expect(backupAtrasado(ultimoBackup(db))).toBe(false)
    expect(readdirSync(join(pasta, 'backups')).some((n) => n.endsWith('.parcial'))).toBe(false)
  })

  it('copia para as pastas extras; pendrive fora não derruba o backup', async () => {
    const drive = join(pasta, 'GoogleDrive')
    mkdirSync(drive)
    salvarConfigBackup(db, { pastasExtras: [drive, 'Z:\\pendrive-que-nao-existe'], intervaloHoras: 4 })
    const r = await servico().fazer('automatico')
    expect(r.ok).toBe(true)
    expect(r.destinos.map((d) => d.ok)).toEqual([true, true, false])
    expect(r.destinos[2]!.erro).toMatch(/pendrive/)
    expect(existsSync(join(drive, r.arquivo))).toBe(true)
  })

  it('devido: sem backup ou depois do intervalo', async () => {
    const s = servico()
    expect(s.devido()).toBe(true)
    await s.fazer('manual')
    expect(s.devido()).toBe(false)
    expect(s.devido(new Date(Date.now() + 4 * 3600 * 1000 + 1000))).toBe(true)
  })

  it('valida antes de restaurar', () => {
    const lixo = join(pasta, 'lixo.db')
    writeFileSync(lixo, 'isto não é sqlite')
    expect(() => validarArquivo(lixo)).toThrow(/não é um banco/)
    expect(() => validarArquivo(join(pasta, 'nao-existe.db'))).toThrow(/não encontrado/)
  })

  it('restaura: guarda o estado atual, troca o banco e reinicia', async () => {
    const s = servico()
    const r = await s.fazer('manual')
    criarProduto(db, entrada({ descricao: 'Feijão (depois do backup)' }))
    await s.restaurar(join(pasta, 'backups', r.arquivo))
    expect(reiniciou).toBe(1)

    const restaurado = abrirBanco(join(pasta, 'pdv.db'))
    const n = (restaurado.prepare('SELECT count(*) AS n FROM produtos').get() as { n: number }).n
    restaurado.close()
    expect(n).toBe(1)
    const antes = listarBackups(join(pasta, 'backups')).find((a) => a.nome.includes('antes-de-restaurar'))
    expect(antes && validarArquivo(antes.caminho).produtos).toBe(2)
  })
})
