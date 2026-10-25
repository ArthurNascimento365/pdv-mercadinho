import { useEffect, useRef, useState } from 'react'
import { centavosParaTexto, formatarMoeda, lerMoeda } from '@shared/dinheiro'
import type { Cliente, ExtratoCliente } from '@shared/fiado'
import { FORMAS_PAGAMENTO, type FormaContavel } from '@shared/vendas'
import { FormCliente, situacaoCliente } from '../componentes/Clientes'
import { mensagemErro, useTeclas } from '../util'

const data = (iso: string): string => new Date(iso).toLocaleDateString('pt-BR')
const TIPOS = { compra: 'Compra', pagamento: 'Pagamento', estorno: 'Estorno (venda cancelada)' }

export function Fiado({ onVoltar }: { onVoltar: () => void }): React.JSX.Element {
  const [termo, setTermo] = useState('')
  const [soDevedores, setSoDevedores] = useState(false)
  const [lista, setLista] = useState<Cliente[]>([])
  const [sel, setSel] = useState(0)
  const [editando, setEditando] = useState<Cliente | 'novo' | null>(null)
  const [aberto, setAberto] = useState<number | null>(null)
  const [recarregar, setRecarregar] = useState(0)
  const [erro, setErro] = useState<string | null>(null)
  const busca = useRef<HTMLInputElement>(null)
  const corpo = useRef<HTMLTableSectionElement>(null)

  useEffect(() => {
    let cancelado = false
    const t = setTimeout(() => {
      window.pdv.fiado
        .buscar(termo, true)
        .then((r) => {
          if (cancelado) return
          setLista(soDevedores ? r.filter((c) => c.saldo > 0).sort((a, b) => b.saldo - a.saldo) : r)
          setSel(0)
        })
        .catch((e: unknown) => setErro(mensagemErro(e)))
    }, 120)
    return () => {
      cancelado = true
      clearTimeout(t)
    }
  }, [termo, soDevedores, recarregar])

  useEffect(() => {
    corpo.current?.children[sel]?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const modal = editando !== null || aberto !== null
  useEffect(() => {
    if (!modal) busca.current?.focus()
  }, [modal])

  useTeclas(
    {
      Escape: onVoltar,
      F2: () => setEditando('novo'),
      F6: () => setSoDevedores((v) => !v),
      ArrowDown: () => setSel((s) => Math.min(s + 1, lista.length - 1)),
      ArrowUp: () => setSel((s) => Math.max(s - 1, 0)),
      Enter: () => {
        const c = lista[sel]
        if (c) setAberto(c.id)
      }
    },
    !modal
  )

  const totalDevido = lista.reduce((s, c) => s + Math.max(0, c.saldo), 0)

  return (
    <main className="pagina">
      <div className="barra">
        <h2>Fiado</h2>
        <input
          ref={busca}
          className="busca"
          placeholder="Buscar cliente por nome ou telefone"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
        />
        <button className={soDevedores ? 'primario' : ''} onClick={() => setSoDevedores((v) => !v)}>
          <kbd>F6</kbd> Só quem deve
        </button>
        <button onClick={() => setEditando('novo')}>
          <kbd>F2</kbd> Novo cliente
        </button>
        <button onClick={onVoltar}>
          <kbd>Esc</kbd> Voltar
        </button>
      </div>
      {erro && <p className="erro">{erro}</p>}

      <div className="tabela-rolagem">
        <table className="tabela">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Telefone</th>
              <th className="num">Acerto</th>
              <th className="num">Limite</th>
              <th className="num">Saldo</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody ref={corpo}>
            {lista.map((c, i) => {
              const s = situacaoCliente(c)
              return (
                <tr
                  key={c.id}
                  className={[i === sel && 'selecionada', !c.ativo && 'inativo'].filter(Boolean).join(' ')}
                  onClick={() => setSel(i)}
                  onDoubleClick={() => setAberto(c.id)}
                >
                  <td>
                    {c.nome}
                    {!c.ativo && <span className="etiqueta">inativo</span>}
                  </td>
                  <td className="codigo">{c.telefone ?? ''}</td>
                  <td className="num">{c.diaAcerto ? `dia ${c.diaAcerto}` : ''}</td>
                  <td className="num">{formatarMoeda(c.limite)}</td>
                  <td className={`num ${c.saldo > 0 ? 'baixo' : ''}`}>{formatarMoeda(c.saldo)}</td>
                  <td className={s.alerta ? 'baixo' : ''}>{s.texto}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {lista.length === 0 && <p className="vazio">Nenhum cliente. F2 cadastra.</p>}
      </div>
      <p className="dica">
        Total a receber nesta lista: <strong>{formatarMoeda(totalDevido)}</strong> · Enter abre o extrato · F2 novo · F6
        só quem deve
      </p>

      {editando !== null && (
        <FormCliente
          cliente={editando === 'novo' ? null : editando}
          onFechar={(c) => {
            setEditando(null)
            if (c) setRecarregar((n) => n + 1)
          }}
        />
      )}
      {aberto !== null && (
        <Extrato
          clienteId={aberto}
          onEditar={(c) => {
            setAberto(null)
            setEditando(c)
          }}
          onFechar={() => {
            setAberto(null)
            setRecarregar((n) => n + 1)
          }}
        />
      )}
    </main>
  )
}

function Extrato({
  clienteId,
  onEditar,
  onFechar
}: {
  clienteId: number
  onEditar: (c: Cliente) => void
  onFechar: () => void
}): React.JSX.Element {
  const [extrato, setExtrato] = useState<ExtratoCliente | null>(null)
  const [recebendo, setRecebendo] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = (): Promise<void> => window.pdv.fiado.extrato(clienteId).then(setExtrato)
  useEffect(() => {
    carregar().catch((e: unknown) => setErro(mensagemErro(e)))
  }, [clienteId])

  async function cobrar(): Promise<void> {
    setErro(null)
    try {
      const c = await window.pdv.fiado.cobranca(clienteId)
      if (!c.link) {
        await navigator.clipboard.writeText(c.texto).catch(() => undefined)
        setAviso('Cliente sem WhatsApp cadastrado. A mensagem foi copiada: cole onde quiser.')
        return
      }
      window.open(c.link, '_blank')
      setAviso('WhatsApp aberto com a mensagem de cobrança.')
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }

  async function alternarAtivo(): Promise<void> {
    if (!extrato) return
    try {
      await window.pdv.fiado.definirAtivo(clienteId, !extrato.cliente.ativo)
      await carregar()
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }

  useTeclas(
    {
      Escape: onFechar,
      F5: () => extrato && extrato.cliente.saldo > 0 && setRecebendo(true),
      F6: () => void cobrar(),
      F4: () => extrato && onEditar(extrato.cliente),
      F8: () => void alternarAtivo()
    },
    !recebendo
  )

  if (!extrato) return <div className="fundo-modal">{erro && <p className="erro">{erro}</p>}</div>
  const { cliente } = extrato

  return (
    <div className="fundo-modal">
      <div className="modal modal-largo">
        <h2>
          {cliente.nome} {!cliente.ativo && <span className="etiqueta">inativo</span>}
        </h2>
        <div className="cartoes">
          <div className="cartao">
            <span>Saldo devedor</span>
            <strong className={cliente.saldo > 0 ? 'baixo' : ''}>{formatarMoeda(cliente.saldo)}</strong>
            <small>limite {formatarMoeda(cliente.limite)}</small>
          </div>
          <div className="cartao">
            <span>Em aberto há</span>
            <strong>{cliente.diasEmAberto === null ? '—' : `${cliente.diasEmAberto} dias`}</strong>
            <small>{cliente.diaAcerto ? `acerto todo dia ${cliente.diaAcerto}` : 'sem dia de acerto'}</small>
          </div>
          <div className="cartao">
            <span>Telefone</span>
            <strong className="codigo">{cliente.telefone ?? '—'}</strong>
            <small>{cliente.observacao ?? ''}</small>
          </div>
        </div>

        {aviso && <p className="aviso">{aviso}</p>}
        {erro && <p className="erro">{erro}</p>}

        <div className="tabela-rolagem previa">
          <table className="tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>Lançamento</th>
                <th className="num">Valor</th>
                <th className="num">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {[...extrato.lancamentos].reverse().map((l) => (
                <tr key={l.id}>
                  <td>{data(l.criadoEm)}</td>
                  <td>
                    {TIPOS[l.tipo]}
                    {l.vendaId && ` · venda nº ${l.vendaId}`}
                    {l.forma && ` · ${FORMAS_PAGAMENTO[l.forma as FormaContavel] ?? l.forma}`}
                    {l.autorizado && <span className="etiqueta">liberado pelo gerente</span>}
                  </td>
                  <td className={`num ${l.tipo === 'compra' ? 'baixo' : 'ok'}`}>
                    {l.tipo === 'compra' ? '+' : '−'}
                    {formatarMoeda(l.valor)}
                  </td>
                  <td className="num">{formatarMoeda(l.saldoApos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {extrato.lancamentos.length === 0 && <p className="vazio">Sem lançamentos.</p>}
        </div>
        {extrato.emAberto.length > 0 && (
          <p className="dica">
            Em aberto: {extrato.emAberto.map((c) => `${data(c.data)} ${formatarMoeda(c.restante)}`).join(' · ')}
          </p>
        )}

        <div className="acoes">
          <button onClick={() => onEditar(cliente)}>
            <kbd>F4</kbd> Editar
          </button>
          <button onClick={() => void alternarAtivo()}>
            <kbd>F8</kbd> {cliente.ativo ? 'Inativar' : 'Reativar'}
          </button>
          <span className="espaco" />
          <button onClick={() => void cobrar()} disabled={cliente.saldo <= 0}>
            <kbd>F6</kbd> Cobrar no WhatsApp
          </button>
          <button className="primario" onClick={() => setRecebendo(true)} disabled={cliente.saldo <= 0}>
            <kbd>F5</kbd> Receber pagamento
          </button>
          <button className="secundario" onClick={onFechar}>
            <kbd>Esc</kbd> Fechar
          </button>
        </div>
      </div>

      {recebendo && (
        <Receber
          cliente={cliente}
          onFeito={async (lancamentoId, msg) => {
            setRecebendo(false)
            setAviso(msg)
            await carregar()
            // Recibo impresso se houver impressora; sem impressora, segue sem aviso.
            try {
              const { impressora } = await window.pdv.hardware.obterConfig()
              if (impressora.modo !== 'nenhuma') await window.pdv.fiado.imprimirRecebimento(lancamentoId)
            } catch (e) {
              setErro(`Recibo não impresso: ${mensagemErro(e)}`)
            }
          }}
          onFechar={() => setRecebendo(false)}
        />
      )}
    </div>
  )
}

const TECLAS_FORMA: Record<string, FormaContavel> = { F1: 'dinheiro', F2: 'debito', F3: 'credito', F4: 'pix' }

function Receber({
  cliente,
  onFeito,
  onFechar
}: {
  cliente: Cliente
  onFeito: (lancamentoId: number, mensagem: string) => void
  onFechar: () => void
}): React.JSX.Element {
  const [valor, setValor] = useState(centavosParaTexto(cliente.saldo))
  const [forma, setForma] = useState<FormaContavel>('dinheiro')
  const [erro, setErro] = useState<string | null>(null)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    campo.current?.focus()
    campo.current?.select()
  }, [forma])

  async function confirmar(): Promise<void> {
    const v = lerMoeda(valor)
    if (v === null || v <= 0) return setErro('Valor inválido')
    try {
      const r = await window.pdv.fiado.receber(cliente.id, v, forma)
      onFeito(
        r.lancamentoId,
        r.cliente.saldo > 0
          ? `Recebido ${formatarMoeda(v)}. ${cliente.nome} ainda deve ${formatarMoeda(r.cliente.saldo)}.`
          : `Recebido ${formatarMoeda(v)}. Fiado de ${cliente.nome} quitado.`
      )
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }

  useTeclas({
    Escape: onFechar,
    Enter: () => void confirmar(),
    ...Object.fromEntries(Object.entries(TECLAS_FORMA).map(([t, f]) => [t, () => setForma(f)]))
  })

  return (
    <div className="fundo-modal">
      <div className="modal modal-pequeno">
        <h2>Receber de {cliente.nome}</h2>
        <p>Deve {formatarMoeda(cliente.saldo)}. Pode receber uma parte.</p>
        <div className="pag-formas">
          {Object.entries(TECLAS_FORMA).map(([t, f]) => (
            <button key={f} className={f === forma ? 'primario' : ''} onClick={() => setForma(f)}>
              <kbd>{t}</kbd> {FORMAS_PAGAMENTO[f]}
            </button>
          ))}
        </div>
        <label>
          Valor recebido
          <input ref={campo} className="campo-grande" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
        </label>
        <p className="dica">O valor entra no caixa aberto como {FORMAS_PAGAMENTO[forma].toLowerCase()}.</p>
        {erro && <p className="erro">{erro}</p>}
        <div className="acoes">
          <span className="espaco" />
          <button className="secundario" onClick={onFechar}>
            <kbd>Esc</kbd> Cancelar
          </button>
          <button className="primario" onClick={() => void confirmar()}>
            <kbd>Enter</kbd> Receber
          </button>
        </div>
      </div>
    </div>
  )
}
