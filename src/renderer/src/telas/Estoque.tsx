import { useEffect, useRef, useState } from 'react'
import { centavosParaTexto, formatarMoeda, lerMoeda, lerQuantidade, quantidadeParaTexto } from '@shared/dinheiro'
import {
  NOMES_MOVIMENTO,
  unidadeVenda,
  type ListaCompras,
  type LoteEmEstoque,
  type MovimentoEstoque,
  type PreviaEntrada,
  type ResumoEntrada
} from '@shared/estoque'
import type { Produto } from '@shared/produtos'
import { BuscaProduto } from '../componentes/Modais'
import { mensagemErro, useTeclas } from '../util'
import { EntradaNfe } from './EntradaNfe'

export type AbaEstoque = 'minimo' | 'entradas' | 'validade' | 'compras'

const ABAS: { aba: AbaEstoque; tecla: string; nome: string }[] = [
  { aba: 'minimo', tecla: 'F6', nome: 'No mínimo' },
  { aba: 'entradas', tecla: 'F7', nome: 'Entradas' },
  { aba: 'validade', tecla: 'F8', nome: 'Validade' },
  { aba: 'compras', tecla: 'F9', nome: 'Lista de compras' }
]

const data = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')
const dataLocal = (aaaammdd: string): string => aaaammdd.split('-').reverse().join('/')
const qtd = (q: number, u: Produto['unidade']): string => `${quantidadeParaTexto(q, u)} ${unidadeVenda(u)}`

function situacaoValidade(dias: number): { texto: string; classe: string } {
  if (dias < 0) return { texto: `vencido há ${-dias} ${dias === -1 ? 'dia' : 'dias'}`, classe: 'baixo' }
  if (dias === 0) return { texto: 'vence hoje', classe: 'baixo' }
  if (dias <= 7) return { texto: `vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}`, classe: 'baixo' }
  return { texto: `vence em ${dias} dias`, classe: dias <= 30 ? 'atencao' : '' }
}

export function Estoque({ onVoltar, abaInicial = 'minimo' }: { onVoltar: () => void; abaInicial?: AbaEstoque }): React.JSX.Element {
  const [aba, setAba] = useState<AbaEstoque>(abaInicial)
  const [minimo, setMinimo] = useState<Produto[]>([])
  const [entradas, setEntradas] = useState<ResumoEntrada[]>([])
  const [lotes, setLotes] = useState<LoteEmEstoque[]>([])
  const [compras, setCompras] = useState<ListaCompras | null>(null)
  const [dias, setDias] = useState('')
  const [sel, setSel] = useState(0)
  const [previa, setPrevia] = useState<PreviaEntrada | null>(null)
  const [historico, setHistorico] = useState<Produto | null>(null)
  const [manual, setManual] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [recarregar, setRecarregar] = useState(0)
  const corpo = useRef<HTMLTableSectionElement>(null)

  useEffect(() => {
    Promise.all([
      window.pdv.estoque.noMinimo(),
      window.pdv.entradas.listar(),
      window.pdv.validade.lotes(),
      window.pdv.compras.lista(null)
    ])
      .then(([m, e, l, c]) => {
        setMinimo(m)
        setEntradas(e)
        setLotes(l)
        setCompras(c)
        setDias((d) => d || String(c.diasCobertura))
      })
      .catch((e: unknown) => setErro(mensagemErro(e)))
  }, [recarregar])

  useEffect(() => setSel(0), [aba])
  useEffect(() => {
    corpo.current?.children[sel]?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  async function executar(acao: () => Promise<string | null>): Promise<void> {
    setErro(null)
    setAviso(null)
    try {
      const msg = await acao()
      if (msg) setAviso(msg)
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }

  const importarXml = (): Promise<void> =>
    executar(async () => {
      const p = await window.pdv.entradas.analisarXml()
      if (p) setPrevia(p)
      return null
    })

  const aplicarDias = (): Promise<void> =>
    executar(async () => {
      const n = Number(dias)
      await window.pdv.compras.definirDias(n)
      setCompras(await window.pdv.compras.lista(n))
      return `Cobertura de ${n} dias salva.`
    })

  const grupos = compras?.grupos ?? []
  const tamanho = { minimo: minimo.length, entradas: entradas.length, validade: lotes.length, compras: grupos.length }[aba]

  const whatsapp = (): Promise<void> =>
    executar(async () => {
      const g = grupos[sel]
      if (!g || !compras) return null
      const { link } = await window.pdv.compras.whatsapp(g.fornecedorId, compras.diasCobertura)
      window.open(link, '_blank')
      return `WhatsApp aberto com o pedido para ${g.fornecedor}.`
    })

  const pdf = (): Promise<void> =>
    executar(async () => ((await window.pdv.compras.pdf(compras?.diasCobertura ?? 7)) ? 'PDF salvo e aberto.' : null))

  useTeclas(
    {
      Escape: onVoltar,
      F4: () => void importarXml(),
      F5: () => setManual(true),
      ...Object.fromEntries(ABAS.map((a) => [a.tecla, () => setAba(a.aba)])),
      F10: () => aba === 'compras' && void pdf(),
      F11: () => aba === 'compras' && void whatsapp(),
      ArrowDown: () => setSel((s) => Math.min(s + 1, tamanho - 1)),
      ArrowUp: () => setSel((s) => Math.max(s - 1, 0)),
      Enter: () => {
        const p = minimo[sel]
        if (aba === 'minimo' && p) setHistorico(p)
      }
    },
    previa === null && historico === null && !manual
  )

  return (
    <main className="pagina">
      <div className="barra">
        <h2>Estoque e entrada</h2>
        {ABAS.map((a) => (
          <button key={a.aba} className={a.aba === aba ? 'primario' : ''} onClick={() => setAba(a.aba)}>
            <kbd>{a.tecla}</kbd> {a.nome}
            {a.aba === 'minimo' && ` (${minimo.length})`}
          </button>
        ))}
        <span className="espaco" />
        <button onClick={() => setManual(true)}>
          <kbd>F5</kbd> Entrada manual
        </button>
        <button onClick={() => void importarXml()}>
          <kbd>F4</kbd> Entrada por XML
        </button>
        <button onClick={onVoltar}>
          <kbd>Esc</kbd> Voltar
        </button>
      </div>

      {aba === 'compras' && (
        <div className="barra">
          <label className="opcao">
            Comprar para
            <input
              className="campo-curto"
              value={dias}
              inputMode="numeric"
              onChange={(e) => setDias(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.stopPropagation()
                  void aplicarDias()
                }
              }}
            />
            dias de venda
          </label>
          <button onClick={() => void aplicarDias()}>Recalcular</button>
          <span className="espaco" />
          <button onClick={() => void whatsapp()} disabled={!grupos.length}>
            <kbd>F11</kbd> Pedido no WhatsApp
          </button>
          <button className="primario" onClick={() => void pdf()} disabled={!grupos.length}>
            <kbd>F10</kbd> Salvar PDF
          </button>
        </div>
      )}

      {aviso && <p className="aviso">{aviso}</p>}
      {erro && <p className="erro">{erro}</p>}

      <div className="tabela-rolagem">
        {aba === 'minimo' && (
          <table className="tabela">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Categoria</th>
                <th className="num">Atual</th>
                <th className="num">Mínimo</th>
                <th className="num">Falta para o mínimo</th>
              </tr>
            </thead>
            <tbody ref={corpo}>
              {minimo.map((p, i) => (
                <tr key={p.id} className={i === sel ? 'selecionada' : ''} onClick={() => setSel(i)} onDoubleClick={() => setHistorico(p)}>
                  <td>{p.descricao}</td>
                  <td>{p.categoria ?? ''}</td>
                  <td className="num baixo">{qtd(p.estoqueAtual, p.unidade)}</td>
                  <td className="num">{qtd(p.estoqueMinimo, p.unidade)}</td>
                  <td className="num">{qtd(Math.max(0, p.estoqueMinimo - p.estoqueAtual), p.unidade)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {aba === 'entradas' && (
          <table className="tabela">
            <thead>
              <tr>
                <th>Entrada</th>
                <th>Data</th>
                <th>Fornecedor</th>
                <th>NF-e</th>
                <th>Emissão</th>
                <th className="num">Itens</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody ref={corpo}>
              {entradas.map((e, i) => (
                <tr key={e.id} className={i === sel ? 'selecionada' : ''} onClick={() => setSel(i)}>
                  <td>{e.id}</td>
                  <td>{data(e.criadoEm)}</td>
                  <td>{e.fornecedor}</td>
                  <td>
                    {e.numero}/{e.serie}
                  </td>
                  <td>{data(e.emissao)}</td>
                  <td className="num">{e.itens}</td>
                  <td className="num">{formatarMoeda(e.valorTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {aba === 'validade' && (
          <table className="tabela">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Lote</th>
                <th>Validade</th>
                <th>Situação</th>
                <th className="num">Na prateleira (estimado)</th>
              </tr>
            </thead>
            <tbody ref={corpo}>
              {lotes.map((l, i) => {
                const s = situacaoValidade(l.dias)
                return (
                  <tr key={l.loteId} className={i === sel ? 'selecionada' : ''} onClick={() => setSel(i)}>
                    <td>{l.descricao}</td>
                    <td className="codigo">{l.lote ?? ''}</td>
                    <td>{dataLocal(l.validade)}</td>
                    <td className={s.classe}>{s.texto}</td>
                    <td className="num">{qtd(l.saldo, l.unidade)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {aba === 'compras' && (
          <div className="grupos-compra">
            {grupos.map((g, i) => (
              <section key={g.fornecedorId ?? 'sem'} className={`grupo-compra ${i === sel ? 'selecionado' : ''}`} onClick={() => setSel(i)}>
                <h3>
                  {g.fornecedor}
                  {g.telefone && <span className="dica"> · {g.telefone}</span>}
                  <span className="espaco" />
                  {g.custoEstimado > 0 && <span className="dica">estimado {formatarMoeda(g.custoEstimado)}</span>}
                </h3>
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Cód. fornecedor</th>
                      <th className="num">Estoque</th>
                      <th className="num">Mínimo</th>
                      <th className="num">Vende/dia</th>
                      <th className="num">Pedir</th>
                      <th className="num">Custo est.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.itens.map((it) => (
                      <tr key={it.produtoId}>
                        <td>{it.descricao}</td>
                        <td className="codigo">{it.codigoFornecedor ?? ''}</td>
                        <td className="num baixo">{qtd(it.estoque, it.unidade)}</td>
                        <td className="num">{qtd(it.minimo, it.unidade)}</td>
                        <td className="num">{quantidadeParaTexto(it.mediaDiaria, it.unidade)}</td>
                        <td className="num">
                          <strong>
                            {it.embalagens !== null
                              ? `${it.embalagens} emb. (${qtd(it.sugerido, it.unidade)})`
                              : qtd(it.sugerido, it.unidade)}
                          </strong>
                        </td>
                        <td className="num">{it.custoEstimado === null ? '—' : formatarMoeda(it.custoEstimado)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        )}

        {tamanho === 0 && (
          <p className="vazio">
            {
              {
                minimo: 'Nenhum produto no estoque mínimo. (Produtos com mínimo 0 não entram nesta lista.)',
                entradas: 'Nenhuma entrada ainda. F4 importa o XML da NF-e, F5 lança sem nota.',
                validade: 'Nenhum lote com validade no estoque. A validade vem do XML (grupo rastro) ou da entrada manual.',
                compras: 'Nada a comprar: nenhum produto chegou no estoque mínimo.'
              }[aba]
            }
          </p>
        )}
      </div>

      <p className="dica">
        {aba === 'minimo' && 'Enter mostra o histórico de estoque · '}
        {aba === 'validade' && 'O caixa não escolhe lote: a estimativa supõe que os que vencem antes saíram antes (FEFO) · '}
        {aba === 'compras' && 'Sugestão = média de venda dos últimos 30 dias × dias de cobertura − estoque, em embalagem fechada · '}
        F4 entrada por XML · F5 entrada manual · Esc volta
      </p>

      {previa && (
        <EntradaNfe
          previa={previa}
          onFechar={(feita) => {
            setPrevia(null)
            if (feita) {
              setAviso(`Entrada nº ${feita.id} registrada: ${feita.itens} itens da NF-e ${feita.numero} (${feita.fornecedor}).`)
              setAba('entradas')
              setRecarregar((n) => n + 1)
            }
          }}
        />
      )}
      {historico && <HistoricoEstoque produto={historico} onFechar={() => setHistorico(null)} />}
      {manual && (
        <EntradaManualModal
          onFechar={(msg) => {
            setManual(false)
            if (msg) {
              setAviso(msg)
              setRecarregar((n) => n + 1)
            }
          }}
        />
      )}
    </main>
  )
}

/** Entrada sem nota: produto (busca), quantidade, custo e validade opcionais. */
function EntradaManualModal({ onFechar }: { onFechar: (mensagem?: string) => void }): React.JSX.Element {
  const [produto, setProduto] = useState<Produto | null>(null)
  const [quantidade, setQuantidade] = useState('')
  const [custo, setCusto] = useState('')
  const [validade, setValidade] = useState('')
  const [lote, setLote] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const refQtd = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (produto) refQtd.current?.focus()
  }, [produto])

  async function salvar(): Promise<void> {
    if (!produto) return
    const q = lerQuantidade(quantidade)
    if (q === null || q <= 0) return setErro('Quantidade inválida')
    const c = custo.trim() ? lerMoeda(custo) : null
    if (custo.trim() && c === null) return setErro('Custo inválido')
    try {
      await window.pdv.validade.entradaManual({ produtoId: produto.id, quantidade: q, custoUnitario: c, validade: validade || null, lote: lote || null })
      onFechar(`Entrada de ${qtd(q, produto.unidade)} de ${produto.descricao} registrada.`)
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }

  useTeclas({ Escape: () => onFechar(), F10: () => void salvar() }, produto !== null)

  if (!produto) return <BuscaProduto onEscolher={setProduto} onFechar={() => onFechar()} />

  return (
    <div className="fundo-modal">
      <div className="modal">
        <h2>Entrada manual · {produto.descricao}</h2>
        <p className="dica">
          Estoque atual: {qtd(produto.estoqueAtual, produto.unidade)} · custo atual{' '}
          {produto.precoCusto === null ? '—' : formatarMoeda(produto.precoCusto)}
        </p>
        <div className="grade">
          <label>
            Quantidade que entrou ({unidadeVenda(produto.unidade)})
            <input ref={refQtd} className="campo-grande" inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          </label>
          <label>
            Custo por {unidadeVenda(produto.unidade)} (opcional, atualiza o custo)
            <input
              inputMode="decimal"
              placeholder={produto.precoCusto !== null ? centavosParaTexto(produto.precoCusto) : '0,00'}
              value={custo}
              onChange={(e) => setCusto(e.target.value)}
            />
          </label>
          <label>
            Validade (opcional)
            <input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} />
          </label>
          <label>
            Lote (opcional)
            <input value={lote} maxLength={40} onChange={(e) => setLote(e.target.value)} />
          </label>
        </div>
        {erro && <p className="erro">{erro}</p>}
        <div className="acoes">
          <button className="secundario" onClick={() => setProduto(null)}>
            Outro produto
          </button>
          <span className="espaco" />
          <button className="secundario" onClick={() => onFechar()}>
            <kbd>Esc</kbd> Cancelar
          </button>
          <button className="primario" onClick={() => void salvar()}>
            <kbd>F10</kbd> Dar entrada
          </button>
        </div>
      </div>
    </div>
  )
}

function HistoricoEstoque({ produto, onFechar }: { produto: Produto; onFechar: () => void }): React.JSX.Element {
  const [movimentos, setMovimentos] = useState<MovimentoEstoque[] | null>(null)

  useEffect(() => {
    window.pdv.estoque
      .movimentos(produto.id)
      .then(setMovimentos)
      .catch(() => setMovimentos([]))
  }, [produto.id])

  useTeclas({ Escape: onFechar, Enter: onFechar })
  const un = unidadeVenda(produto.unidade)

  return (
    <div className="fundo-modal">
      <div className="modal modal-largo">
        <h2>Histórico de estoque · {produto.descricao}</h2>
        <div className="tabela-rolagem previa">
          <table className="tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>Movimento</th>
                <th className="num">Quantidade</th>
                <th className="num">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {(movimentos ?? []).map((m) => (
                <tr key={m.id}>
                  <td>{new Date(m.criadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>
                    {NOMES_MOVIMENTO[m.tipo]}
                    {m.vendaId && ` nº ${m.vendaId}`}
                    {m.entradaId && ` nº ${m.entradaId}`}
                  </td>
                  <td className={`num ${m.quantidade < 0 ? 'baixo' : ''}`}>
                    {m.quantidade > 0 ? '+' : ''}
                    {quantidadeParaTexto(m.quantidade, produto.unidade)} {un}
                  </td>
                  <td className="num">
                    {quantidadeParaTexto(m.saldo, produto.unidade)} {un}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {movimentos?.length === 0 && <p className="vazio">Sem movimentos.</p>}
        </div>
        <div className="acoes">
          <span className="espaco" />
          <button className="primario" onClick={onFechar}>
            <kbd>Esc</kbd> Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
