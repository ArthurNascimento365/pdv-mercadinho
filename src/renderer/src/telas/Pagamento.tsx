import { useEffect, useRef, useState } from 'react'
import { centavosParaTexto, formatarMoeda, lerMoeda } from '@shared/dinheiro'
import { FORMAS_PAGAMENTO, type FormaPagamento, type Venda } from '@shared/vendas'
import { BuscaCliente, SenhaGerente } from '../componentes/Clientes'
import { QrPix } from '../componentes/QrPix'
import { exigeGerente, mensagemErro, useTeclas } from '../util'

const TECLAS: Record<string, FormaPagamento> = { F1: 'dinheiro', F2: 'debito', F3: 'credito', F4: 'pix', F5: 'fiado' }

type Modal = { tipo: 'cliente' } | { tipo: 'gerente'; motivo: string; centavos: number } | null

interface Props {
  venda: Venda
  onAtualizar: (venda: Venda) => void
  onFinalizada: (venda: Venda) => void
  onFechar: () => void
}

/**
 * Recebimento: escolhe a forma (F1–F4), digita o valor (já vem o restante) e Enter.
 * Com tudo pago, Enter finaliza. Dá para combinar formas (ex.: parte no Pix, parte em dinheiro).
 */
export function Pagamento({ venda, onAtualizar, onFinalizada, onFechar }: Props): React.JSX.Element {
  const [forma, setForma] = useState<FormaPagamento>('dinheiro')
  const [valor, setValor] = useState(centavosParaTexto(venda.restante))
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [modal, setModal] = useState<Modal>(null)
  /** Aviso depois de lançar uma parte: quanto falta e que dá para escolher outra forma. */
  const [lancado, setLancado] = useState<string | null>(null)
  const campo = useRef<HTMLInputElement>(null)

  const quitada = venda.restante === 0
  const trocoPrevisto = Math.max(0, venda.pago - venda.total)

  useEffect(() => {
    setValor(centavosParaTexto(venda.restante))
  }, [venda.restante, forma])

  // Foco no valor só quando não há modal por cima (senão rouba o foco da senha do gerente).
  useEffect(() => {
    if (modal) return
    campo.current?.focus()
    campo.current?.select()
  }, [venda.restante, forma, modal])

  function escolherForma(f: FormaPagamento): void {
    if (quitada) return
    setForma(f)
    // Fiado precisa saber de quem é: pede o cliente na hora.
    if (f === 'fiado' && venda.clienteId === null) setModal({ tipo: 'cliente' })
  }

  async function lancar(centavos: number, senha: string | null): Promise<void> {
    const v = await window.pdv.vendas.adicionarPagamento(forma, centavos, senha)
    onAtualizar(v)
    setLancado(
      v.restante > 0
        ? `${formatarMoeda(centavos)} em ${FORMAS_PAGAMENTO[forma].toLowerCase()} lançado. Falta ${formatarMoeda(v.restante)}: escolha a próxima forma.`
        : null
    )
    setForma('dinheiro')
  }

  /** Valor rápido no campo: o restante todo ou a metade (para dividir em duas formas). */
  function preencher(centavos: number): void {
    setValor(centavosParaTexto(centavos))
    campo.current?.focus()
    requestAnimationFrame(() => campo.current?.select())
  }

  async function executar(acao: () => Promise<void>): Promise<void> {
    if (ocupado) return
    setOcupado(true)
    setErro(null)
    try {
      await acao()
    } catch (e) {
      setErro(mensagemErro(e))
      campo.current?.select()
    } finally {
      setOcupado(false)
    }
  }

  const confirmar = (): Promise<void> =>
    executar(async () => {
      if (quitada) {
        onFinalizada(await window.pdv.vendas.finalizar())
        return
      }
      const centavos = lerMoeda(valor)
      if (centavos === null || centavos <= 0) throw new Error('Valor inválido')
      if (forma === 'fiado' && venda.clienteId === null) {
        setModal({ tipo: 'cliente' })
        return
      }
      try {
        await lancar(centavos, null)
      } catch (e) {
        // Limite estourado ou atraso: o gerente pode liberar.
        if (!exigeGerente(e)) throw e
        setModal({ tipo: 'gerente', motivo: mensagemErro(e), centavos })
      }
    })

  const remover = (pagamentoId: number): Promise<void> =>
    executar(async () => {
      onAtualizar(await window.pdv.vendas.removerPagamento(pagamentoId))
      setLancado(null)
    })

  const removerUltimo = async (): Promise<void> => {
    const ultimo = venda.pagamentos.at(-1)
    if (ultimo) await remover(ultimo.id)
  }

  useTeclas(
    {
      ...Object.fromEntries(Object.entries(TECLAS).map(([tecla, f]) => [tecla, () => escolherForma(f)])),
      Enter: () => void confirmar(),
      F6: () => setModal({ tipo: 'cliente' }),
      F7: () =>
        void executar(async () => {
          const v = lerMoeda(valor)
          if (forma !== 'pix' || !v) throw new Error('Escolha Pix (F4) e o valor para imprimir o QR')
          await window.pdv.pix.imprimir(v, venda.id)
        }),
      F8: () => void removerUltimo(),
      Escape: onFechar
    },
    modal === null
  )

  return (
    <div className="fundo-modal">
      <div className="modal modal-pagamento">
        <h2>Pagamento · venda nº {venda.id}</h2>
        {venda.clienteNome && (
          <p className="dica">
            Cliente: <strong>{venda.clienteNome}</strong> (F6 troca)
          </p>
        )}

        <div className="pag-resumo">
          <div>
            <span>Total</span>
            <strong>{formatarMoeda(venda.total)}</strong>
          </div>
          <div>
            <span>Recebido</span>
            <strong>{formatarMoeda(venda.pago)}</strong>
          </div>
          <div className={quitada ? 'pag-troco' : 'pag-falta'}>
            <span>{quitada ? 'Troco' : 'Falta'}</span>
            <strong>{formatarMoeda(quitada ? trocoPrevisto : venda.restante)}</strong>
          </div>
        </div>

        {venda.pagamentos.length > 0 && (
          <div className="pag-lancados">
            <span className="cartao-rotulo">Pagamentos lançados</span>
            <ul className="pag-lista">
              {venda.pagamentos.map((p) => (
                <li key={p.id}>
                  <span>{FORMAS_PAGAMENTO[p.forma]}</span>
                  <span className="espaco" />
                  <b>{formatarMoeda(p.valor)}</b>
                  <button
                    className="link acao-perigo"
                    title="Remover este pagamento"
                    onClick={() => void remover(p.id)}
                    disabled={ocupado}
                  >
                    remover
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {lancado && !quitada && <p className="aviso">{lancado}</p>}

        {!quitada && (
          <>
            <div className="pag-formas">
              {Object.entries(TECLAS).map(([tecla, f]) => (
                <button key={f} className={f === forma ? 'primario' : ''} onClick={() => escolherForma(f)}>
                  <kbd>{tecla}</kbd> {FORMAS_PAGAMENTO[f]}
                </button>
              ))}
            </div>
            <label>
              Valor em {FORMAS_PAGAMENTO[forma].toLowerCase()}
              {forma === 'pix' && ' (confira o recebimento no celular antes de confirmar)'}
              <div className="pag-valor">
                <input
                  ref={campo}
                  className="campo-grande"
                  inputMode="decimal"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                />
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => preencher(venda.restante)}>
                  Restante
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => preencher(Math.ceil(venda.restante / 2))}
                >
                  Metade
                </button>
              </div>
            </label>
            {venda.pagamentos.length === 0 && (
              <p className="dica">
                Para dividir (ex.: parte no Pix e parte no cartão, ou dois cartões), digite só o valor desta forma e
                tecle Enter; depois escolha a próxima forma para o restante.
              </p>
            )}
            {forma === 'pix' && <QrPix valor={lerMoeda(valor)} vendaId={venda.id} />}
          </>
        )}

        {erro && <p className="erro">{erro}</p>}

        <div className="acoes">
          {venda.pagamentos.length > 0 && (
            <button className="secundario" onClick={() => void removerUltimo()} disabled={ocupado}>
              <kbd>F8</kbd> Remover último
            </button>
          )}
          <span className="espaco" />
          <button className="secundario" onClick={onFechar}>
            <kbd>Esc</kbd> Voltar à venda
          </button>
          <button className="primario" onClick={() => void confirmar()} disabled={ocupado}>
            <kbd>Enter</kbd> {quitada ? 'Finalizar venda' : 'Lançar pagamento'}
          </button>
        </div>
      </div>

      {modal?.tipo === 'cliente' && (
        <BuscaCliente
          onEscolher={async (c) => {
            try {
              onAtualizar(await window.pdv.vendas.definirCliente(c.id))
            } catch (e) {
              setErro(mensagemErro(e))
            }
            setModal(null)
          }}
          onSemCliente={async () => {
            try {
              onAtualizar(await window.pdv.vendas.definirCliente(null))
              if (forma === 'fiado') setForma('dinheiro')
            } catch (e) {
              setErro(mensagemErro(e))
            }
            setModal(null)
          }}
          onFechar={() => {
            if (forma === 'fiado' && venda.clienteId === null) setForma('dinheiro')
            setModal(null)
          }}
        />
      )}
      {modal?.tipo === 'gerente' && (
        <SenhaGerente
          motivo={modal.motivo}
          onSenha={async (senha) => {
            try {
              await lancar(modal.centavos, senha)
              setModal(null)
              return null
            } catch (e) {
              return mensagemErro(e)
            }
          }}
          onFechar={() => setModal(null)}
        />
      )}
    </div>
  )
}
