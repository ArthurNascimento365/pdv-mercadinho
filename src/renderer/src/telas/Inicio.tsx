import { useEffect, useState } from 'react'
import { backupAtrasado, type ResultadoBackup } from '@shared/backup'
import type { ResumoCaixa } from '@shared/caixa'
import type { AlertasValidade } from '@shared/estoque'
import type { InfoSistema } from '@shared/ipc'
import type { Tela } from '../App'
import { mensagemErro, useTeclas } from '../util'

interface Modulo {
  tecla: string
  nome: string
  fase: number
  tela?: Tela
}

// Atalhos reservados; cada módulo é ligado quando sua fase do roadmap for entregue.
const MODULOS: Modulo[] = [
  { tecla: 'F2', nome: 'Vender', fase: 2, tela: 'vender' },
  { tecla: 'F3', nome: 'Produtos', fase: 1, tela: 'produtos' },
  { tecla: 'F4', nome: 'Caixa', fase: 3, tela: 'caixa' },
  { tecla: 'F5', nome: 'Estoque e entrada', fase: 3, tela: 'estoque' },
  { tecla: 'F6', nome: 'Fiado', fase: 5, tela: 'fiado' },
  { tecla: 'F7', nome: 'Relatórios', fase: 5, tela: 'relatorios' },
  { tecla: 'F8', nome: 'Backup', fase: 5, tela: 'backup' },
  { tecla: 'F9', nome: 'Configurações', fase: 1, tela: 'configuracoes' }
]

export function Inicio({ onAbrir }: { onAbrir: (tela: Tela) => void }): React.JSX.Element {
  const [info, setInfo] = useState<InfoSistema | null>(null)
  const [caixa, setCaixa] = useState<ResumoCaixa | null | undefined>(undefined)
  const [noMinimo, setNoMinimo] = useState(0)
  const [backup, setBackup] = useState<ResultadoBackup | null | undefined>(undefined)
  const [validade, setValidade] = useState<AlertasValidade | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      window.pdv.sistema.info(),
      window.pdv.caixa.paraVender(),
      window.pdv.estoque.contarNoMinimo(),
      window.pdv.backup.estado(),
      window.pdv.validade.alertas()
    ])
      .then(([i, c, n, b, v]) => {
        setInfo(i)
        setCaixa(c)
        setNoMinimo(n)
        setBackup(b.ultimo)
        setValidade(v)
      })
      .catch((e: unknown) => setErro(mensagemErro(e)))
  }, [])

  useTeclas(
    Object.fromEntries(
      MODULOS.filter((m) => m.tela).map((m) => [m.tecla, () => onAbrir(m.tela!)])
    )
  )

  return (
    <>
      <main className="inicio">
        <div className="alertas">
          {caixa === null && (
            <button className="alerta alerta-forte" onClick={() => onAbrir('caixa')}>
              Caixa fechado. <kbd>F4</kbd> para abrir antes de vender.
            </button>
          )}
          {caixa && (
            <span className="alerta">
              Caixa nº {caixa.id} aberto · {caixa.operador} · {caixa.vendas.quantidade} vendas
            </span>
          )}
          {backup !== undefined && backupAtrasado(backup) && (
            <button className="alerta alerta-forte" onClick={() => onAbrir('backup')}>
              {backup?.ok === false ? 'O último backup falhou.' : 'Backup atrasado (mais de 24 h).'} <kbd>F8</kbd> para
              ver.
            </button>
          )}
          {validade && validade.vencidos.length + validade.em7.length + validade.em30.length > 0 && (
            <button
              className={`alerta ${validade.vencidos.length + validade.em7.length > 0 ? 'alerta-forte' : ''}`}
              onClick={() => onAbrir('estoque')}
            >
              Validade: {validade.vencidos.length} vencidos · {validade.em7.length} vencem em 7 dias ·{' '}
              {validade.em30.length} em 30 dias. <kbd>F5</kbd> → <kbd>F8</kbd>
            </button>
          )}
          {noMinimo > 0 && (
            <button className="alerta alerta-forte" onClick={() => onAbrir('estoque')}>
              {noMinimo} {noMinimo === 1 ? 'produto chegou' : 'produtos chegaram'} no estoque mínimo.{' '}
              <kbd>F5</kbd> para ver.
            </button>
          )}
        </div>
      <div className="modulos">
        {MODULOS.map((m) => (
          <button
            key={m.tecla}
            className="modulo"
            disabled={!m.tela}
            title={m.tela ? undefined : `Chega na fase ${m.fase}`}
            onClick={() => m.tela && onAbrir(m.tela)}
          >
            <kbd>{m.tecla}</kbd>
            <span className="modulo-nome">{m.nome}</span>
            {!m.tela && <span className="modulo-fase">fase {m.fase}</span>}
          </button>
        ))}
      </div>
      </main>

      <footer className="rodape">
        {erro && <span className="erro">Erro: {erro}</span>}
        {info && (
          <>
            <span>v{info.versaoApp}</span>
            <span>schema {info.versaoSchema}</span>
            <span>SQLite {info.versaoSqlite}</span>
            <span className="caminho" title={info.caminhoBanco}>
              {info.caminhoBanco}
            </span>
          </>
        )}
      </footer>
    </>
  )
}
