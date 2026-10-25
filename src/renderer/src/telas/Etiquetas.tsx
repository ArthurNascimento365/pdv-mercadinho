import { useEffect, useRef, useState } from 'react'
import { formatarMoeda } from '@shared/dinheiro'
import { hojeLocal, precoTabela, promocaoAtiva } from '@shared/precos'
import type { Produto } from '@shared/produtos'
import { mensagemErro, useTeclas } from '../util'

/** Etiquetas de gôndola em lote: produtos com preço/promoção alterados desde a data escolhida. */
export function Etiquetas({ onFechar }: { onFechar: () => void }): React.JSX.Element {
  const [desde, setDesde] = useState<string>('')
  const [ultima, setUltima] = useState<string | null>(null)
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [marcados, setMarcados] = useState<Set<number>>(new Set())
  const [sel, setSel] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const corpo = useRef<HTMLTableSectionElement>(null)
  const hoje = hojeLocal()

  async function carregar(data: string | null): Promise<void> {
    try {
      const r = await window.pdv.etiquetas.listar(data ? new Date(`${data}T00:00:00`).toISOString() : null)
      setUltima(r.ultimaImpressao)
      setProdutos(r.produtos)
      setMarcados(new Set(r.produtos.map((p) => p.id)))
      setSel(0)
      if (!data) {
        const base = r.ultimaImpressao ? new Date(r.ultimaImpressao) : new Date(Date.now() - 7 * 86_400_000)
        setDesde(hojeLocal(base))
      }
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }

  useEffect(() => {
    void carregar(null)
  }, [])

  useEffect(() => {
    corpo.current?.children[sel]?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const alternar = (id: number): void =>
    setMarcados((m) => {
      const n = new Set(m)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  async function gerar(): Promise<void> {
    setErro(null)
    try {
      const ids = produtos.filter((p) => marcados.has(p.id)).map((p) => p.id)
      if (await window.pdv.etiquetas.pdf(ids)) {
        setAviso(`${ids.length} etiquetas geradas. Próxima leva: o que mudar a partir de agora.`)
      }
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }

  useTeclas({
    Escape: onFechar,
    F10: () => void gerar(),
    ArrowDown: () => setSel((s) => Math.min(s + 1, produtos.length - 1)),
    ArrowUp: () => setSel((s) => Math.max(s - 1, 0)),
    ' ': (e) => {
      if (e.target instanceof HTMLInputElement) return
      const p = produtos[sel]
      if (p) alternar(p.id)
    }
  })

  return (
    <div className="fundo-modal">
      <div className="modal modal-largo">
        <h2>Etiquetas de gôndola</h2>
        <div className="barra">
          <label className="opcao">
            Alterados desde
            <input
              type="date"
              value={desde}
              onChange={(e) => {
                setDesde(e.target.value)
                if (e.target.value) void carregar(e.target.value)
              }}
            />
          </label>
          <span className="dica">
            Última impressão: {ultima ? new Date(ultima).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca'}
          </span>
          <span className="espaco" />
          <button onClick={() => setMarcados(new Set(produtos.map((p) => p.id)))}>Marcar todos</button>
          <button onClick={() => setMarcados(new Set())}>Desmarcar</button>
        </div>
        {aviso && <p className="aviso">{aviso}</p>}
        {erro && <p className="erro">{erro}</p>}
        <div className="tabela-rolagem previa">
          <table className="tabela">
            <thead>
              <tr>
                <th />
                <th>Produto</th>
                <th>EAN</th>
                <th className="num">Preço na etiqueta</th>
                <th>Alterado em</th>
              </tr>
            </thead>
            <tbody ref={corpo}>
              {produtos.map((p, i) => {
                const promo = promocaoAtiva(p, hoje)
                return (
                  <tr key={p.id} className={i === sel ? 'selecionada' : ''} onClick={() => setSel(i)}>
                    <td>
                      <input type="checkbox" checked={marcados.has(p.id)} onChange={() => alternar(p.id)} />
                    </td>
                    <td>
                      {p.descricao}
                      {promo && <span className="etiqueta oferta">oferta</span>}
                    </td>
                    <td className="codigo">{p.ean ?? (p.codigoBalanca !== null ? `PLU ${p.codigoBalanca}` : '—')}</td>
                    <td className="num">
                      {formatarMoeda(precoTabela(p, hoje).preco)}
                      {p.unidade === 'KG' ? '/kg' : ''}
                    </td>
                    <td>{new Date(p.precoAlteradoEm).toLocaleDateString('pt-BR')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {produtos.length === 0 && <p className="vazio">Nenhum preço mudou desde essa data.</p>}
        </div>
        <p className="dica">
          Folha A4 com 21 etiquetas (63,5 × 38,1 mm, padrão Pimaco A4256) · ↑ ↓ escolhe · Espaço marca/desmarca
        </p>
        <div className="acoes">
          <span className="espaco" />
          <button className="secundario" onClick={onFechar}>
            <kbd>Esc</kbd> Fechar
          </button>
          <button className="primario" onClick={() => void gerar()} disabled={marcados.size === 0}>
            <kbd>F10</kbd> Gerar PDF ({marcados.size})
          </button>
        </div>
      </div>
    </div>
  )
}
