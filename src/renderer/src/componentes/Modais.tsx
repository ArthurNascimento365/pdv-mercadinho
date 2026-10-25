import { useEffect, useRef, useState } from 'react'
import { centavosParaTexto, formatarMoeda, type Centavos } from '@shared/dinheiro'
import type { Produto } from '@shared/produtos'
import { lerDesconto } from '@shared/vendas'
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

type TipoDesconto = 'porcentagem' | 'valor'

/** Desconto digitado no tipo escolhido, em centavos; null se inválido. Vazio = 0 (tira o desconto). */
function lerDescontoDoTipo(tipo: TipoDesconto, texto: string, base: Centavos): Centavos | null {
  const limpo = texto.trim()
  if (!limpo) return 0
  if (tipo === 'valor') return limpo.includes('%') ? null : lerDesconto(limpo, base)
  return lerDesconto(`${limpo.replace(/%$/, '')}%`, base)
}

/**
 * Desconto na venda: o operador escolhe porcentagem (F1) ou valor em reais (F2)
 * e vê o total com desconto antes de confirmar.
 */
export function DescontoVenda({
  subtotal,
  descontoAtual,
  confirmar,
  onFechar
}: {
  subtotal: Centavos
  descontoAtual: Centavos
  /** Devolve a mensagem de erro, ou null se deu certo (quem chamou fecha o modal). */
  confirmar: (desconto: Centavos) => Promise<string | null>
  onFechar: () => void
}): React.JSX.Element {
  const [tipo, setTipo] = useState<TipoDesconto>(descontoAtual > 0 ? 'valor' : 'porcentagem')
  const [texto, setTexto] = useState(descontoAtual > 0 ? centavosParaTexto(descontoAtual) : '')
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    campo.current?.focus()
    campo.current?.select()
  }, [tipo])

  const desconto = lerDescontoDoTipo(tipo, texto, subtotal)
  const valido = desconto !== null && desconto <= subtotal

  function escolher(novo: TipoDesconto): void {
    if (novo === tipo) return
    setTipo(novo)
    setTexto('')
    setErro(null)
  }

  async function enviar(): Promise<void> {
    if (ocupado) return
    if (desconto === null) {
      setErro(tipo === 'porcentagem' ? 'Porcentagem inválida: de 0 a 100 (ex.: 10 ou 7,5)' : 'Valor inválido (ex.: 5,00)')
      return
    }
    if (desconto > subtotal) {
      setErro(`Desconto maior que a venda (${formatarMoeda(subtotal)})`)
      return
    }
    setOcupado(true)
    try {
      const problema = await confirmar(desconto)
      if (problema) setErro(problema)
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setOcupado(false)
    }
  }

  useTeclas({
    Escape: onFechar,
    Enter: () => void enviar(),
    F1: () => escolher('porcentagem'),
    F2: () => escolher('valor')
  })

  return (
    <div className="fundo-modal">
      <div className="modal modal-pequeno">
        <h2>Desconto na venda</h2>
        <p>Subtotal {formatarMoeda(subtotal)}</p>
        <div className="tipo-desconto">
          <button
            className={tipo === 'porcentagem' ? 'primario' : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => escolher('porcentagem')}
          >
            <kbd>F1</kbd> Porcentagem (%)
          </button>
          <button
            className={tipo === 'valor' ? 'primario' : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => escolher('valor')}
          >
            <kbd>F2</kbd> Valor (R$)
          </button>
        </div>
        <label>
          {tipo === 'porcentagem' ? 'Porcentagem de desconto' : 'Valor do desconto em reais'}
          <div className="campo-unidade">
            {tipo === 'valor' && <span>R$</span>}
            <input
              ref={campo}
              className="campo-grande"
              inputMode="decimal"
              value={texto}
              placeholder={tipo === 'porcentagem' ? '0' : '0,00'}
              onChange={(e) => {
                setTexto(e.target.value)
                setErro(null)
              }}
            />
            {tipo === 'porcentagem' && <span>%</span>}
          </div>
        </label>
        <div className="linha-total">
          <span>Desconto</span>
          <span>{valido ? `-${formatarMoeda(desconto)}` : '—'}</span>
        </div>
        <div className="linha-total">
          <strong>Total com desconto</strong>
          <strong>{valido ? formatarMoeda(subtotal - desconto) : '—'}</strong>
        </div>
        <p className="dica">Vazio ou 0 tira o desconto.</p>
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
