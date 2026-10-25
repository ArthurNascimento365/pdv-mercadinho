import { useEffect, useRef, useState } from 'react'
import { formatarMoeda } from '@shared/dinheiro'
import type { Produto } from '@shared/produtos'
import { mensagemErro, useTeclas } from '../util'

interface PromptProps {
  titulo: string
  rotulo: string
  dica?: string
  inicial?: string
  /** Devolve a mensagem de erro, ou null se deu certo (quem chamou fecha o modal). */
  confirmar: (texto: string) => Promise<string | null>
  onFechar: () => void
}

/** Pede um valor (peso, desconto...). Enter confirma, Esc fecha. */
export function Prompt({ titulo, rotulo, dica, inicial = '', confirmar, onFechar }: PromptProps): React.JSX.Element {
  const [texto, setTexto] = useState(inicial)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    campo.current?.focus()
    campo.current?.select()
  }, [])

  async function enviar(): Promise<void> {
    if (ocupado) return
    setOcupado(true)
    try {
      const problema = await confirmar(texto)
      if (problema) {
        setErro(problema)
        campo.current?.select()
      }
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setOcupado(false)
    }
  }

  useTeclas({ Escape: onFechar, Enter: () => void enviar() })

  return (
    <div className="fundo-modal">
      <div className="modal modal-pequeno">
        <h2>{titulo}</h2>
        <label>
          {rotulo}
          <input ref={campo} className="campo-grande" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </label>
        {dica && <p className="dica">{dica}</p>}
        {erro && <p className="erro">{erro}</p>}
        <div className="acoes">
          <span className="espaco" />
          <button className="secundario" onClick={onFechar}>
            <kbd>Esc</kbd> Cancelar
          </button>
          <button className="primario" onClick={() => void enviar()} disabled={ocupado}>
            <kbd>Enter</kbd> Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}

interface ConfirmarProps {
  titulo: string
  mensagem: React.ReactNode
  rotuloSim: string
  onSim: () => Promise<void>
  onFechar: () => void
}

/** Confirmação de ação que não se desfaz. Enter confirma, Esc desiste. */
export function Confirmar({ titulo, mensagem, rotuloSim, onSim, onFechar }: ConfirmarProps): React.JSX.Element {
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function sim(): Promise<void> {
    if (ocupado) return
    setOcupado(true)
    try {
      await onSim()
    } catch (e) {
      setErro(mensagemErro(e))
      setOcupado(false)
    }
  }

  useTeclas({ Escape: onFechar, Enter: () => void sim() })

  return (
    <div className="fundo-modal">
      <div className="modal modal-pequeno">
        <h2>{titulo}</h2>
        <div>{mensagem}</div>
        {erro && <p className="erro">{erro}</p>}
        <div className="acoes">
          <span className="espaco" />
          <button className="secundario" onClick={onFechar}>
            <kbd>Esc</kbd> Voltar
          </button>
          <button className="perigo" onClick={() => void sim()} disabled={ocupado}>
            <kbd>Enter</kbd> {rotuloSim}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Busca por nome para quando o produto não tem código ou a etiqueta não lê. */
export function BuscaProduto({
  onEscolher,
  onFechar
}: {
  onEscolher: (produto: Produto) => void
  onFechar: () => void
}): React.JSX.Element {
  const [termo, setTermo] = useState('')
  const [lista, setLista] = useState<Produto[]>([])
  const [sel, setSel] = useState(0)
  const campo = useRef<HTMLInputElement>(null)
  const corpo = useRef<HTMLTableSectionElement>(null)

  useEffect(() => campo.current?.focus(), [])

  useEffect(() => {
    if (!termo.trim()) {
      setLista([])
      return
    }
    let cancelado = false
    const espera = setTimeout(() => {
      window.pdv.produtos
        .buscar(termo)
        .then((r) => {
          if (cancelado) return
          setLista(r)
          setSel(0)
        })
        .catch(() => !cancelado && setLista([]))
    }, 120)
    return () => {
      cancelado = true
      clearTimeout(espera)
    }
  }, [termo])

  useEffect(() => {
    corpo.current?.children[sel]?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  useTeclas({
    Escape: onFechar,
    ArrowDown: () => setSel((s) => Math.min(s + 1, lista.length - 1)),
    ArrowUp: () => setSel((s) => Math.max(s - 1, 0)),
    Enter: () => {
      const p = lista[sel]
      if (p) onEscolher(p)
    }
  })

  return (
    <div className="fundo-modal">
      <div className="modal modal-largo">
        <h2>Buscar produto</h2>
        <input
          ref={campo}
          className="campo-grande"
          placeholder="Digite parte do nome"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
        />
        <div className="tabela-rolagem previa">
          <table className="tabela">
            <thead>
              <tr>
                <th>Descrição</th>
                <th>Un</th>
                <th className="num">Preço</th>
              </tr>
            </thead>
            <tbody ref={corpo}>
              {lista.map((p, i) => (
                <tr
                  key={p.id}
                  className={i === sel ? 'selecionada' : ''}
                  onClick={() => setSel(i)}
                  onDoubleClick={() => onEscolher(p)}
                >
                  <td>{p.descricao}</td>
                  <td>{p.unidade}</td>
                  <td className="num">
                    {formatarMoeda(p.precoVenda)}
                    {p.unidade === 'KG' ? '/kg' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {termo.trim() && lista.length === 0 && <p className="vazio">Nada encontrado.</p>}
        </div>
        <p className="dica">↑ ↓ escolhe · Enter adiciona · Esc fecha</p>
      </div>
    </div>
  )
}
