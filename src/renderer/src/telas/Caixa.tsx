import { useEffect, useRef, useState } from 'react'
import type { Contagem, ResumoCaixa } from '@shared/caixa'
import { formatarMoeda, lerMoeda } from '@shared/dinheiro'
import { FORMAS_CONTAVEIS, FORMAS_PAGAMENTO, type FormaContavel } from '@shared/vendas'
import { EVENTO_CAIXA } from '../App'
import { mensagemErro, useTeclas } from '../util'

const FORMAS = FORMAS_CONTAVEIS

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`

const dataHora = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

/** Enter pula para o próximo campo do formulário. */
function proximoCampo(e: React.KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return
  const campos = Array.from(e.currentTarget.querySelectorAll<HTMLInputElement>('input'))
  const proximo = campos[campos.indexOf(e.target) + 1]
  if (proximo) {
    e.preventDefault()
    e.stopPropagation()
    proximo.focus()
  }
}

type Modal = { tipo: 'sangria' | 'suprimento' } | { tipo: 'fechar' } | null

export function Caixa({ onVoltar }: { onVoltar: () => void }): React.JSX.Element {
  const [caixa, setCaixa] = useState<ResumoCaixa | null | undefined>(undefined)
  const [fechado, setFechado] = useState<ResumoCaixa | null>(null)
  const [historico, setHistorico] = useState<ResumoCaixa[]>([])
  const [modal, setModal] = useState<Modal>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [temImpressora, setTemImpressora] = useState(false)

  useEffect(() => {
    Promise.all([window.pdv.caixa.atual(), window.pdv.hardware.obterConfig()])
      .then(([c, hw]) => {
        setCaixa(c)
        setTemImpressora(hw.impressora.modo !== 'nenhuma')
      })
      .catch((e: unknown) => setErro(mensagemErro(e)))
  }, [])

  /** Impressão/gaveta não pode travar o caixa: falha vira aviso. */
  async function hardware(acao: () => Promise<void>, ok: string | null = null): Promise<void> {
    setErro(null)
    try {
      await acao()
      if (ok) setAviso(ok)
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }

  useEffect(() => {
    if (caixa === null) window.pdv.caixa.listar().then(setHistorico).catch(() => setHistorico([]))
  }, [caixa])

  // Cabeçalho mostra o caixa aberto: avisa quando ele abre ou fecha.
  useEffect(() => {
    window.dispatchEvent(new Event(EVENTO_CAIXA))
  }, [caixa?.id, fechado])

  useTeclas(
    {
      Escape: onVoltar,
      F5: () => caixa && setModal({ tipo: 'sangria' }),
      F6: () => caixa && setModal({ tipo: 'suprimento' }),
      F10: () => caixa && setModal({ tipo: 'fechar' }),
      F8: () => void hardware(() => window.pdv.hardware.abrirGaveta(), 'Gaveta aberta.')
    },
    modal === null && caixa !== undefined && !fechado && !!caixa
  )

  if (caixa === undefined) return <main className="pagina">{erro && <p className="erro">{erro}</p>}</main>

  if (fechado) {
    return (
      <RelatorioFechamento
        caixa={fechado}
        erro={erro}
        onImprimir={() => void hardware(() => window.pdv.hardware.imprimirFechamento(fechado.id))}
        onVoltar={() => {
          setFechado(null)
          setCaixa(null)
        }}
      />
    )
  }

  if (!caixa) {
    return <AbrirCaixa historico={historico} onAberto={setCaixa} onVoltar={onVoltar} onVerFechamento={setFechado} />
  }

  return (
    <main className="pagina pagina-media">
      <div className="barra">
        <div className="barra-titulo">
          <h2>Caixa nº {caixa.id}</h2>
          <span className="selo-aberto">aberto</span>
          <span className="dica">
            {caixa.operador} · desde {dataHora(caixa.abertoEm)} · fundo {formatarMoeda(caixa.fundoTroco)}
          </span>
        </div>
        <span className="espaco" />
        <button onClick={() => setModal({ tipo: 'sangria' })}>
          <kbd>F5</kbd> Sangria
        </button>
        <button onClick={() => setModal({ tipo: 'suprimento' })}>
          <kbd>F6</kbd> Suprimento
        </button>
        <button onClick={() => void hardware(() => window.pdv.hardware.abrirGaveta(), 'Gaveta aberta.')}>
          <kbd>F8</kbd> Abrir gaveta
        </button>
        <button className="primario" onClick={() => setModal({ tipo: 'fechar' })}>
          <kbd>F10</kbd> Fechar caixa
        </button>
      </div>
      {aviso && <p className="aviso">{aviso}</p>}
      {erro && <p className="erro">{erro}</p>}

      <div className="cartoes cartoes-caixa">
        <div className="cartao cartao-destaque">
          <span>Total vendido</span>
          <strong>{formatarMoeda(caixa.vendas.total)}</strong>
          <small>
            {plural(caixa.vendas.quantidade, 'venda', 'vendas')} ·{' '}
            {plural(caixa.vendas.canceladas, 'cancelada', 'canceladas')}
          </small>
        </div>
        {FORMAS.map((f) => (
          <div key={f} className="cartao">
            <span>{FORMAS_PAGAMENTO[f]}</span>
            <strong>{formatarMoeda(caixa.recebido[f])}</strong>
          </div>
        ))}
        <div className="cartao">
          <span>Vendido no fiado</span>
          <strong>{formatarMoeda(caixa.vendidoFiado)}</strong>
          <small>recebido de fiado: {formatarMoeda(caixa.recebimentosFiado)}</small>
        </div>
      </div>
      <p className="dica">
        O dinheiro esperado na gaveta (fundo + vendas + suprimentos − sangrias) só aparece no fechamento: quem fecha
        conta antes de ver o esperado.
      </p>

      <section className="secao">
        <h3>Sangrias e suprimentos</h3>
        {caixa.movimentos.length === 0 ? (
          <p className="dica">Nenhum movimento neste caixa.</p>
        ) : (
          <table className="tabela tabela-zebra">
            <tbody>
              {caixa.movimentos.map((m) => (
                <tr key={m.id}>
                  <td>{dataHora(m.criadoEm)}</td>
                  <td>{m.tipo === 'sangria' ? 'Sangria' : 'Suprimento'}</td>
                  <td>{m.motivo ?? ''}</td>
                  <td className="num">
                    {m.tipo === 'sangria' ? '−' : '+'}
                    {formatarMoeda(m.valor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {modal && modal.tipo !== 'fechar' && (
        <MovimentoModal
          tipo={modal.tipo}
          onFeito={(c) => {
            setCaixa(c)
            setModal(null)
            const movimento = c.movimentos.at(-1)
            setAviso(`${modal.tipo === 'sangria' ? 'Sangria' : 'Suprimento'} registrado.`)
            // Comprovante com assinatura + gaveta aberta para tirar/pôr o dinheiro.
            if (temImpressora && movimento) {
              void hardware(() => window.pdv.hardware.comprovanteMovimento(c.id, movimento.id))
            }
          }}
          onFechar={() => setModal(null)}
        />
      )}
      {modal?.tipo === 'fechar' && (
        <FechamentoModal
          onFechado={(c) => {
            setModal(null)
            setFechado(c)
            if (temImpressora) void hardware(() => window.pdv.hardware.imprimirFechamento(c.id))
          }}
          onFechar={() => setModal(null)}
        />
      )}
    </main>
  )
}

function AbrirCaixa({
  historico,
  onAberto,
  onVoltar,
  onVerFechamento
}: {
  historico: ResumoCaixa[]
  onAberto: (c: ResumoCaixa) => void
  onVoltar: () => void
  onVerFechamento: (c: ResumoCaixa) => void
}): React.JSX.Element {
  const [operador, setOperador] = useState('')
  const [fundo, setFundo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const refOperador = useRef<HTMLInputElement>(null)

  useEffect(() => refOperador.current?.focus(), [])

  async function abrir(): Promise<void> {
    setErro(null)
    const valor = fundo.trim() === '' ? 0 : lerMoeda(fundo)
    if (valor === null || valor < 0) {
      setErro('Fundo de troco inválido')
      return
    }
    try {
      onAberto(await window.pdv.caixa.abrir(operador, valor))
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }

  useTeclas({ Escape: onVoltar, F10: () => void abrir(), Enter: () => void abrir() })

  return (
    <main className="pagina pagina-media">
      <div className="barra">
        <div className="barra-titulo">
          <h2>Caixa fechado</h2>
          <span className="selo-fechado">fechado</span>
        </div>
      </div>

      <section className="secao secao-destaque" onKeyDown={proximoCampo}>
        <h3>Abrir caixa</h3>
        <p className="dica">Informe quem vai operar e quanto há de troco na gaveta. Enter passa para o próximo campo.</p>
        <div className="grade">
          <label>
            Operador
            <input ref={refOperador} value={operador} maxLength={60} onChange={(e) => setOperador(e.target.value)} />
          </label>
          <label>
            Fundo de troco (R$)
            <input value={fundo} inputMode="decimal" placeholder="0,00" onChange={(e) => setFundo(e.target.value)} />
          </label>
        </div>
        {erro && <p className="erro">{erro}</p>}
        <div className="acoes">
          <span className="espaco" />
          <button className="primario" onClick={() => void abrir()}>
            <kbd>F10</kbd> Abrir caixa
          </button>
        </div>
      </section>

      {historico.length > 0 && (
        <section className="secao">
          <h3>Últimos fechamentos</h3>
          <table className="tabela tabela-zebra">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Operador</th>
                <th>Aberto</th>
                <th>Fechado</th>
                <th className="num">Vendido</th>
                <th className="num">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {historico
                .filter((c) => c.status === 'fechado')
                .map((c) => {
                  const dif = c.fechamento?.reduce((s, l) => s + l.diferenca, 0) ?? 0
                  return (
                    <tr key={c.id} onDoubleClick={() => onVerFechamento(c)}>
                      <td>{c.id}</td>
                      <td>{c.operador}</td>
                      <td>{dataHora(c.abertoEm)}</td>
                      <td>{dataHora(c.fechadoEm)}</td>
                      <td className="num">{formatarMoeda(c.vendas.total)}</td>
                      <td className={`num ${dif < 0 ? 'baixo' : ''}`}>{formatarMoeda(dif)}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
          <p className="dica">Duplo clique abre o fechamento.</p>
        </section>
      )}
    </main>
  )
}

function MovimentoModal({
  tipo,
  onFeito,
  onFechar
}: {
  tipo: 'sangria' | 'suprimento'
  onFeito: (c: ResumoCaixa) => void
  onFechar: () => void
}): React.JSX.Element {
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const refValor = useRef<HTMLInputElement>(null)

  useEffect(() => refValor.current?.focus(), [])

  async function confirmar(): Promise<void> {
    const v = lerMoeda(valor)
    if (v === null || v <= 0) {
      setErro('Valor inválido')
      return
    }
    try {
      onFeito(await window.pdv.caixa.movimentar(tipo, v, motivo.trim() || null))
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }

  useTeclas({ Escape: onFechar, Enter: () => void confirmar(), F10: () => void confirmar() })

  return (
    <div className="fundo-modal">
      <div className="modal modal-pequeno" onKeyDown={proximoCampo}>
        <h2>{tipo === 'sangria' ? 'Sangria (retirada da gaveta)' : 'Suprimento (reforço de troco)'}</h2>
        <label>
          Valor (R$)
          <input
            ref={refValor}
            className="campo-grande"
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
        </label>
        <label>
          Motivo (opcional)
          <input value={motivo} maxLength={120} onChange={(e) => setMotivo(e.target.value)} />
        </label>
        {erro && <p className="erro">{erro}</p>}
        <div className="acoes">
          <span className="espaco" />
          <button className="secundario" onClick={onFechar}>
            <kbd>Esc</kbd> Cancelar
          </button>
          <button className="primario" onClick={() => void confirmar()}>
            <kbd>F10</kbd> Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}

/** Fechamento cego: pede a contagem de cada forma sem mostrar o esperado. */
function FechamentoModal({
  onFechado,
  onFechar
}: {
  onFechado: (c: ResumoCaixa) => void
  onFechar: () => void
}): React.JSX.Element {
  const [valores, setValores] = useState<Record<FormaContavel, string>>({ dinheiro: '', debito: '', credito: '', pix: '' })
  const [observacao, setObservacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const refPrimeiro = useRef<HTMLInputElement>(null)

  useEffect(() => refPrimeiro.current?.focus(), [])

  async function confirmar(): Promise<void> {
    setErro(null)
    const contagem = {} as Contagem
    for (const f of FORMAS) {
      const v = valores[f].trim() === '' ? 0 : lerMoeda(valores[f])
      if (v === null || v < 0) {
        setErro(`Valor inválido em ${FORMAS_PAGAMENTO[f]}`)
        return
      }
      contagem[f] = v
    }
    try {
      onFechado(await window.pdv.caixa.fechar(contagem, observacao.trim() || null))
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }

  useTeclas({ Escape: onFechar, F10: () => void confirmar() })

  return (
    <div className="fundo-modal">
      <div className="modal" onKeyDown={proximoCampo}>
        <h2>Fechar caixa</h2>
        <p className="dica">
          Conte a gaveta e some os comprovantes de cartão e os Pix recebidos. Deixe em branco o que for zero. O
          esperado aparece depois de confirmar.
        </p>
        <div className="grade">
          {FORMAS.map((f, i) => (
            <label key={f}>
              {f === 'dinheiro' ? 'Dinheiro na gaveta (com o fundo de troco)' : `Total em ${FORMAS_PAGAMENTO[f]}`}
              <input
                ref={i === 0 ? refPrimeiro : undefined}
                className="campo-grande"
                inputMode="decimal"
                placeholder="0,00"
                value={valores[f]}
                onChange={(e) => setValores((v) => ({ ...v, [f]: e.target.value }))}
              />
            </label>
          ))}
          <label className="largo">
            Observação (opcional)
            <input value={observacao} maxLength={500} onChange={(e) => setObservacao(e.target.value)} />
          </label>
        </div>
        {erro && <p className="erro">{erro}</p>}
        <div className="acoes">
          <span className="espaco" />
          <button className="secundario" onClick={onFechar}>
            <kbd>Esc</kbd> Voltar
          </button>
          <button className="primario" onClick={() => void confirmar()}>
            <kbd>F10</kbd> Fechar caixa
          </button>
        </div>
      </div>
    </div>
  )
}

function RelatorioFechamento({
  caixa,
  erro,
  onImprimir,
  onVoltar
}: {
  caixa: ResumoCaixa
  erro: string | null
  onImprimir: () => void
  onVoltar: () => void
}): React.JSX.Element {
  useTeclas({ Escape: onVoltar, Enter: onVoltar, F12: onImprimir })
  const linhas = caixa.fechamento ?? []
  const diferenca = linhas.reduce((s, l) => s + l.diferenca, 0)

  return (
    <main className="pagina pagina-media">
      <div className="barra">
        <div className="barra-titulo">
          <h2>Fechamento do caixa nº {caixa.id}</h2>
        </div>
        <span className="espaco" />
        <button onClick={onImprimir}>
          <kbd>F12</kbd> Imprimir
        </button>
        <button className="primario" onClick={onVoltar}>
          <kbd>Enter</kbd> Concluir
        </button>
      </div>
      {erro && <p className="erro">{erro}</p>}
      <section className="secao">
        <p>
          {caixa.operador} · {dataHora(caixa.abertoEm)} até {dataHora(caixa.fechadoEm)} ·{' '}
          {plural(caixa.vendas.quantidade, 'venda', 'vendas')} ({formatarMoeda(caixa.vendas.total)}) ·{' '}
          {plural(caixa.vendas.canceladas, 'cancelada', 'canceladas')}
        </p>
        <p className="dica">
          Dinheiro esperado = fundo {formatarMoeda(caixa.fundoTroco)} + vendas {formatarMoeda(caixa.recebido.dinheiro)} +
          suprimentos {formatarMoeda(caixa.suprimentos)} − sangrias {formatarMoeda(caixa.sangrias)}
        </p>
        <p className={`resultado-fechamento ${diferenca === 0 ? 'resultado-ok' : diferenca < 0 ? 'resultado-falta' : 'resultado-sobra'}`}>
          {diferenca === 0
            ? 'Caixa conferido: sem diferença.'
            : diferenca < 0
              ? `Falta de ${formatarMoeda(-diferenca)} no caixa.`
              : `Sobra de ${formatarMoeda(diferenca)} no caixa.`}
        </p>
        <table className="tabela tabela-zebra">
          <thead>
            <tr>
              <th>Forma</th>
              <th className="num">Esperado</th>
              <th className="num">Contado</th>
              <th className="num">Diferença</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.forma}>
                <td>{FORMAS_PAGAMENTO[l.forma]}</td>
                <td className="num">{formatarMoeda(l.esperado)}</td>
                <td className="num">{formatarMoeda(l.contado)}</td>
                <td className={`num ${l.diferenca < 0 ? 'baixo' : l.diferenca > 0 ? 'sobra' : ''}`}>
                  {formatarMoeda(l.diferenca)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {caixa.observacao && <p>Observação: {caixa.observacao}</p>}
      </section>
    </main>
  )
}
