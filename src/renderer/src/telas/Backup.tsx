import { useEffect, useRef, useState } from 'react'
import { backupAtrasado, type EstadoBackup, type InfoBackupValido, type MotivoBackup } from '@shared/backup'
import { Confirmar } from '../componentes/Modais'
import { mensagemErro, useTeclas } from '../util'

const MOTIVOS: Record<MotivoBackup, string> = {
  automatico: 'automático',
  fechamento: 'fechamento de caixa',
  manual: 'manual',
  'antes-de-restaurar': 'antes de restaurar'
}

const dataHora = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
const tamanho = (bytes: number): string =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.ceil(bytes / 1024)} KB`

export function Backup({ onVoltar }: { onVoltar: () => void }): React.JSX.Element {
  const [estado, setEstado] = useState<EstadoBackup | null>(null)
  const [sel, setSel] = useState(0)
  const [restaurar, setRestaurar] = useState<InfoBackupValido | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const corpo = useRef<HTMLTableSectionElement>(null)

  const carregar = (): Promise<void> => window.pdv.backup.estado().then(setEstado)

  useEffect(() => {
    carregar().catch((e: unknown) => setErro(mensagemErro(e)))
  }, [])

  useEffect(() => {
    corpo.current?.children[sel]?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  async function executar(acao: () => Promise<string | null>): Promise<void> {
    if (ocupado) return
    setOcupado(true)
    setErro(null)
    setAviso(null)
    try {
      const msg = await acao()
      if (msg) setAviso(msg)
      await carregar()
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setOcupado(false)
    }
  }

  const fazer = (): Promise<void> =>
    executar(async () => {
      const r = await window.pdv.backup.fazer()
      if (!r.ok) throw new Error(`Backup falhou: ${r.destinos[0]?.erro ?? 'erro desconhecido'}`)
      const falhas = r.destinos.filter((d) => !d.ok)
      return falhas.length
        ? `Backup feito na pasta principal, mas falhou em: ${falhas.map((f) => `${f.pasta} (${f.erro})`).join('; ')}`
        : `Backup feito: ${r.arquivo}`
    })

  const adicionarPasta = (): Promise<void> =>
    executar(async () => {
      if (!estado) return null
      const pasta = await window.pdv.backup.escolherPasta()
      if (!pasta) return null
      await window.pdv.backup.salvarConfig({ ...estado.config, pastasExtras: [...estado.config.pastasExtras, pasta] })
      return `Pasta adicionada: ${pasta}`
    })

  const removerPasta = (pasta: string): Promise<void> =>
    executar(async () => {
      if (!estado) return null
      await window.pdv.backup.salvarConfig({
        ...estado.config,
        pastasExtras: estado.config.pastasExtras.filter((p) => p !== pasta)
      })
      return null
    })

  const mudarIntervalo = (horas: number): Promise<void> =>
    executar(async () => {
      if (!estado) return null
      await window.pdv.backup.salvarConfig({ ...estado.config, intervaloHoras: horas })
      return `Backup automático a cada ${horas} h.`
    })

  const escolherParaRestaurar = (caminho: string | null): Promise<void> =>
    executar(async () => {
      const info = await window.pdv.backup.validar(caminho)
      if (info) setRestaurar(info)
      return null
    })

  useTeclas(
    {
      Escape: onVoltar,
      F5: () => void fazer(),
      F4: () => void adicionarPasta(),
      F6: () => void escolherParaRestaurar(null),
      ArrowDown: () => setSel((s) => Math.min(s + 1, (estado?.arquivos.length ?? 1) - 1)),
      ArrowUp: () => setSel((s) => Math.max(s - 1, 0)),
      Enter: () => {
        const a = estado?.arquivos[sel]
        if (a) void escolherParaRestaurar(a.caminho)
      }
    },
    restaurar === null
  )

  if (!estado) return <main className="pagina">{erro && <p className="erro">{erro}</p>}</main>
  const { ultimo } = estado
  const atrasado = backupAtrasado(ultimo)

  return (
    <main className="pagina pagina-estreita">
      <div className="barra">
        <h2>Backup</h2>
        <span className="espaco" />
        <button className="primario" onClick={() => void fazer()} disabled={ocupado}>
          <kbd>F5</kbd> {ocupado ? 'Trabalhando…' : 'Fazer backup agora'}
        </button>
        <button onClick={onVoltar}>
          <kbd>Esc</kbd> Voltar
        </button>
      </div>

      {aviso && <p className="aviso">{aviso}</p>}
      {erro && <p className="erro">{erro}</p>}

      <section className="secao">
        <h3>Último backup</h3>
        {ultimo ? (
          <>
            <p className={atrasado ? 'erro' : 'aviso'}>
              {ultimo.ok ? 'Feito' : 'FALHOU'} em {dataHora(ultimo.quando)} ({MOTIVOS[ultimo.motivo]})
              {atrasado && ultimo.ok && ' — há mais de 24 horas'}
            </p>
            <ul className="lista-simples">
              {ultimo.destinos.map((d) => (
                <li key={d.pasta}>
                  <span className={d.ok ? 'ok' : 'baixo'}>{d.ok ? '✓' : '✗'}</span> {d.pasta}
                  {d.erro && <span className="baixo"> — {d.erro}</span>}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="erro">Nenhum backup feito ainda. Tecle F5.</p>
        )}
        <p className="dica">
          Automático a cada{' '}
          <select
            className="select-inline"
            value={estado.config.intervaloHoras}
            onChange={(e) => void mudarIntervalo(Number(e.target.value))}
          >
            {[1, 2, 4, 6, 8, 12, 24].map((h) => (
              <option key={h} value={h}>
                {h} h
              </option>
            ))}
          </select>{' '}
          e em todo fechamento de caixa. Guarda 7 backups diários e 4 semanais em cada pasta. O banco continua em uso
          durante a cópia: não precisa parar o caixa.
        </p>
      </section>

      <section className="secao">
        <h3>Onde guardar</h3>
        <ul className="lista-simples">
          <li>
            <strong>Principal:</strong> {estado.pastaPrincipal}
          </li>
          {estado.config.pastasExtras.map((p) => (
            <li key={p}>
              {p}{' '}
              <button className="link" onClick={() => void removerPasta(p)}>
                remover
              </button>
            </li>
          ))}
        </ul>
        <div className="acoes">
          <button onClick={() => void adicionarPasta()} disabled={ocupado}>
            <kbd>F4</kbd> Adicionar pasta (pendrive, Google Drive, OneDrive)
          </button>
        </div>
        <p className="dica">
          Recomendado: uma pasta sincronizada com a nuvem (Google Drive ou OneDrive para computador) e um pendrive. Se o
          pendrive estiver fora, o backup continua nas outras pastas e o aviso aparece aqui.
        </p>
      </section>

      <section className="secao">
        <h3>Restaurar</h3>
        {estado.arquivos.length === 0 ? (
          <p className="dica">Nenhum backup na pasta principal.</p>
        ) : (
          <div className="tabela-rolagem previa">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Backup</th>
                  <th>Data</th>
                  <th className="num">Tamanho</th>
                </tr>
              </thead>
              <tbody ref={corpo}>
                {estado.arquivos.map((a, i) => (
                  <tr
                    key={a.caminho}
                    className={i === sel ? 'selecionada' : ''}
                    onClick={() => setSel(i)}
                    onDoubleClick={() => void escolherParaRestaurar(a.caminho)}
                  >
                    <td className="codigo">{a.nome}</td>
                    <td>{dataHora(a.data)}</td>
                    <td className="num">{tamanho(a.tamanho)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="acoes">
          <span className="dica">↑ ↓ escolhe · Enter restaura o selecionado</span>
          <span className="espaco" />
          <button onClick={() => void escolherParaRestaurar(null)} disabled={ocupado}>
            <kbd>F6</kbd> Restaurar de outro arquivo
          </button>
        </div>
      </section>

      {restaurar && (
        <Confirmar
          titulo="Restaurar este backup?"
          mensagem={
            <>
              <p className="codigo">{restaurar.caminho}</p>
              <p>
                Backup íntegro: {restaurar.produtos} produtos, {restaurar.vendas} vendas, última venda em{' '}
                {dataHora(restaurar.ultimaVenda)}.
              </p>
              <p className="erro">
                Tudo o que foi feito depois deste backup some do PDV. O estado atual é guardado antes como "antes de
                restaurar" e o PDV reinicia sozinho.
              </p>
            </>
          }
          rotuloSim="Restaurar e reiniciar"
          onSim={async () => {
            await window.pdv.backup.restaurar(restaurar.caminho)
          }}
          onFechar={() => setRestaurar(null)}
        />
      )}
    </main>
  )
}
