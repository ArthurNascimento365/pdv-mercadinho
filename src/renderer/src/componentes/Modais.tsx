import { useEffect, useRef, useState } from 'react'
import { centavosParaTexto, formatarMoeda, type Centavos } from '@shared/dinheiro'
import { TABELAS_PRECO, type TabelaPreco } from '@shared/precos'
import type { Produto } from '@shared/produtos'
import { lerDesconto } from '@shared/vendas'
import { FormProduto } from '../telas/FormProduto'
import { mensagemErro, useTeclas } from '../util'
import { Icone } from './Icone'

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

interface AjusteVendaProps {
  /** Devolve a mensagem de erro, ou null se deu certo (quem chamou fecha o modal). */
  confirmar: (valor: Centavos) => Promise<string | null>
  onFechar: () => void
}

/**
 * Desconto na venda: o operador escolhe porcentagem (F1) ou valor em reais (F2)
 * e vê o total com desconto antes de confirmar.
 */
export function DescontoVenda({
  subtotal,
  descontoAtual,
  ...resto
}: AjusteVendaProps & { subtotal: Centavos; descontoAtual: Centavos }): React.JSX.Element {
  return <AjusteVenda modo="desconto" base={subtotal} atual={descontoAtual} {...resto} />
}

/**
 * Acréscimo na venda: mesma janela do desconto, somando. A porcentagem vale sobre o total
 * sem acréscimo (subtotal − desconto da venda).
 */
export function AcrescimoVenda({
  base,
  acrescimoAtual,
  ...resto
}: AjusteVendaProps & { base: Centavos; acrescimoAtual: Centavos }): React.JSX.Element {
  return <AjusteVenda modo="acrescimo" base={base} atual={acrescimoAtual} {...resto} />
}

function AjusteVenda({
  modo,
  base,
  atual,
  confirmar,
  onFechar
}: AjusteVendaProps & { modo: 'desconto' | 'acrescimo'; base: Centavos; atual: Centavos }): React.JSX.Element {
  const desconto = modo === 'desconto'
  const nome = desconto ? 'desconto' : 'acréscimo'
  const [tipo, setTipo] = useState<TipoDesconto>(atual > 0 ? 'valor' : 'porcentagem')
  const [texto, setTexto] = useState(atual > 0 ? centavosParaTexto(atual) : '')
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    campo.current?.focus()
    campo.current?.select()
  }, [tipo])

  const valor = lerDescontoDoTipo(tipo, texto, base)
  const valido = valor !== null && (!desconto || valor <= base)
  const total = valor === null ? 0 : desconto ? base - valor : base + valor

  function escolher(novo: TipoDesconto): void {
    if (novo === tipo) return
    setTipo(novo)
    setTexto('')
    setErro(null)
  }

  async function enviar(): Promise<void> {
    if (ocupado) return
    if (valor === null) {
      setErro(tipo === 'porcentagem' ? 'Porcentagem inválida: de 0 a 100 (ex.: 10 ou 7,5)' : 'Valor inválido (ex.: 5,00)')
      return
    }
    if (desconto && valor > base) {
      setErro(`Desconto maior que a venda (${formatarMoeda(base)})`)
      return
    }
    setOcupado(true)
    try {
      const problema = await confirmar(valor)
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
        <h2>{desconto ? 'Desconto na venda' : 'Acréscimo na venda'}</h2>
        <p>
          {desconto ? 'Subtotal' : 'Total sem acréscimo'} {formatarMoeda(base)}
        </p>
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
          {tipo === 'porcentagem' ? `Porcentagem de ${nome}` : `Valor do ${nome} em reais`}
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
          <span>{desconto ? 'Desconto' : 'Acréscimo'}</span>
          <span>{valido ? `${desconto ? '-' : '+'}${formatarMoeda(valor)}` : '—'}</span>
        </div>
        <div className="linha-total">
          <strong>Total com {nome}</strong>
          <strong>{valido ? formatarMoeda(total) : '—'}</strong>
        </div>
        <p className="dica">Vazio ou 0 tira o {nome}.</p>
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

/**
 * Tabela de preço do item recém-lançado (ou do item escolhido, F4). A janela fica à vista do
 * cliente, então não mostra preço: setas escolhem, Enter confirma, Esc deixa como está.
 * Se chegar um dígito (o leitor bipou o próximo produto sem o operador responder), a janela
 * fecha sem mudar a tabela e o dígito segue para o campo de código.
 */
export function EscolhaTabela({
  descricao,
  quantidade,
  atual,
  onEscolher,
  onDigito,
  onFechar
}: {
  descricao: string
  quantidade: string
  atual: TabelaPreco
  onEscolher: (tabela: TabelaPreco) => void
  onDigito: (caractere: string) => void
  onFechar: () => void
}): React.JSX.Element {
  const [marcada, setMarcada] = useState<TabelaPreco>(atual)
  const ref = useRef({ marcada, onEscolher, onDigito, onFechar })
  ref.current = { marcada, onEscolher, onDigito, onFechar }

  useEffect(() => {
    const ouvir = (e: KeyboardEvent): void => {
      const acao: Record<string, () => void> = {
        ArrowLeft: () => setMarcada('varejo'),
        ArrowUp: () => setMarcada('varejo'),
        ArrowRight: () => setMarcada('a_prazo'),
        ArrowDown: () => setMarcada('a_prazo'),
        Tab: () => setMarcada((m) => (m === 'varejo' ? 'a_prazo' : 'varejo')),
        Enter: () => ref.current.onEscolher(ref.current.marcada),
        Escape: () => ref.current.onFechar()
      }
      if (acao[e.key]) {
        e.preventDefault()
        acao[e.key]!()
      } else if (/^[0-9*]$/.test(e.key)) {
        e.preventDefault()
        ref.current.onDigito(e.key)
      }
    }
    window.addEventListener('keydown', ouvir)
    return () => window.removeEventListener('keydown', ouvir)
  }, [])

  const opcao = (tabela: TabelaPreco): React.JSX.Element => (
    <button
      className={`tabela-opcao ${tabela === marcada ? 'tabela-atual' : ''}`}
      aria-pressed={tabela === marcada}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onEscolher(tabela)}
    >
      {tabela === marcada && <Icone nome="ok" tamanho={22} />}
      {TABELAS_PRECO[tabela]}
    </button>
  )

  // Cartão compacto no pé da lista, sem escurecer a tela: item e total continuam à vista.
  return (
    <div className="escolha-tabela" role="dialog" aria-label="Tabela de preço">
      <p className="escolha-tabela-item">
        Tabela de preço · <b>{descricao}</b> · {quantidade}
      </p>
      <div className="tabela-opcoes">
        {opcao('varejo')}
        {opcao('a_prazo')}
      </div>
      <p className="dica">
        <kbd>←</kbd> <kbd>→</kbd> escolhe · <kbd>Enter</kbd> confirma · <kbd>Esc</kbd> deixa como está
      </p>
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
  const [novo, setNovo] = useState(false)
  const campo = useRef<HTMLInputElement>(null)
  const corpo = useRef<HTMLTableSectionElement>(null)

  // Com o cadastro aberto, o foco é dele (o campo da busca só volta a pegá-lo depois).
  useEffect(() => {
    if (!novo) campo.current?.focus()
  }, [novo])

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

  useTeclas(
    {
      Escape: onFechar,
      ArrowDown: () => setSel((s) => Math.min(s + 1, lista.length - 1)),
      ArrowUp: () => setSel((s) => Math.max(s - 1, 0)),
      Enter: () => {
        const p = lista[sel]
        if (p) onEscolher(p)
      },
      F2: () => setNovo(true)
    },
    !novo
  )

  // O que foi digitado vira o código (só números) ou a descrição do produto novo.
  const t = termo.trim()
  const sugestao = /^d+$/.test(t) ? { ean: t } : t ? { descricao: t } : undefined

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
          {termo.trim() && lista.length === 0 && <p className="vazio">Nada encontrado. F2 cadastra o produto.</p>}
        </div>
        <div className="acoes">
          <p className="dica">↑ ↓ escolhe · Enter adiciona · Esc fecha</p>
          <span className="espaco" />
          <button className="secundario" onClick={() => setNovo(true)}>
            <kbd>F2</kbd> Novo produto
          </button>
        </div>
      </div>
      {novo && (
        <FormProduto
          produto={null}
          sugestao={sugestao}
          onFechar={(p) => {
            setNovo(false)
            if (p) onEscolher(p)
          }}
          onAbrirExistente={(p) => {
            setNovo(false)
            onEscolher(p)
          }}
        />
      )}
    </div>
  )
}
