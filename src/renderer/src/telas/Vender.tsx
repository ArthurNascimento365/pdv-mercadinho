import { useEffect, useRef, useState } from 'react'
import { centavosParaTexto, formatarMoeda, lerMoeda, lerQuantidade, quantidadeParaTexto } from '@shared/dinheiro'
import type { ResumoCaixa } from '@shared/caixa'
import type { Produto } from '@shared/produtos'
import {
  FORMAS_PAGAMENTO,
  lerDesconto,
  lerEntradaCaixa,
  type ItemVenda,
  type OpcoesTabela,
  type Venda
} from '@shared/vendas'
import type { Diagramado } from '@shared/impressao'
import { BuscaCliente } from '../componentes/Clientes'
import { Icone } from '../componentes/Icone'
import { AcrescimoVenda, BuscaProduto, Confirmar, DescontoVenda, EscolhaTabela, Prompt } from '../componentes/Modais'
import { PesoBalanca } from '../componentes/PesoBalanca'
import { PreviaCupom } from '../componentes/PreviaCupom'
import { bipeErro, mensagemErro, useTeclas } from '../util'
import { Pagamento } from './Pagamento'

type Modal =
  | { tipo: 'busca' }
  | { tipo: 'peso'; produto: Produto }
  | { tipo: 'precoLivre'; produto: Produto; quantidade: number }
  | { tipo: 'descontoItem'; item: ItemVenda }
  | { tipo: 'descontoVenda' }
  | { tipo: 'acrescimoVenda' }
  | { tipo: 'cancelarItem'; item: ItemVenda }
  | { tipo: 'cancelarVenda' }
  | { tipo: 'cancelarUltima'; venda: Venda }
  | { tipo: 'pagamento' }
  | { tipo: 'previa'; vendaId: number; documento: Diagramado }
  | { tipo: 'cliente' }
  | { tipo: 'tabela'; item: ItemVenda }

const qtd = (q: number, unidade: 'UN' | 'KG'): string =>
  unidade === 'KG' ? `${quantidadeParaTexto(q, 'KG')} kg` : quantidadeParaTexto(q, 'UN')

/**
 * Barra de ações do caixa, agrupada pelo que a ação afeta. Cada botão também tem a tecla
 * de atalho; o pagamento (Enter com o campo vazio, ou F10) fica no painel do total e Esc no
 * cabeçalho. A tabela do item (F4) não tem botão: a janela abre sozinha a cada item novo.
 */
const GRUPOS: { nome: string; botoes: { tecla: string; rotulo: string; perigo?: boolean }[] }[] = [
  {
    nome: 'Item',
    botoes: [
      { tecla: 'F2', rotulo: 'Buscar produto' },
      { tecla: 'F5', rotulo: 'Desconto no item' },
      { tecla: 'F7', rotulo: 'Cancelar item', perigo: true }
    ]
  },
  {
    nome: 'Venda',
    botoes: [
      { tecla: 'F3', rotulo: 'Cliente (fiado)' },
      { tecla: 'F6', rotulo: 'Desconto na venda' },
      { tecla: 'F1', rotulo: 'Acréscimo pendente' },
      { tecla: 'F8', rotulo: 'Cancelar venda', perigo: true }
    ]
  },
  {
    nome: 'Cupom',
    botoes: [
      { tecla: 'F11', rotulo: 'Ver último' },
      { tecla: 'F12', rotulo: 'Reimprimir' },
      { tecla: 'F9', rotulo: 'Cancelar última', perigo: true }
    ]
  }
]

/**
 * Célula da lista de itens editável com um clique (quantidade e desconto).
 * Enter ou sair do campo salva; Esc desiste.
 */
function CelulaEditavel({
  texto,
  inicial,
  editavel,
  onSalvar,
  onFim
}: {
  texto: string
  inicial: string
  editavel: boolean
  onSalvar: (texto: string) => void
  onFim: () => void
}): React.JSX.Element {
  const [editando, setEditando] = useState(false)
  const terminado = useRef(false)

  if (!editavel) return <>{texto}</>
  if (!editando) {
    return (
      <button
        className={`celula-editavel ${texto ? '' : 'celula-vazia'}`}
        tabIndex={-1}
        title="Clique para editar"
        // Não tira o foco do campo de código: senão ele o retoma e rouba o do editor.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          terminado.current = false
          setEditando(true)
        }}
      >
        {texto || '—'}
      </button>
    )
  }

  function terminar(salvar: boolean, valor: string): void {
    if (terminado.current) return
    terminado.current = true
    setEditando(false)
    if (salvar && valor.trim() !== inicial) onSalvar(valor.trim())
    onFim()
  }

  return (
    <input
      className="celula-input"
      autoFocus
      defaultValue={inicial}
      inputMode="decimal"
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        // Enter/Esc/setas são do campo, não dos atalhos da tela.
        if (['Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.stopPropagation()
        if (e.key === 'Enter') terminar(true, e.currentTarget.value)
        if (e.key === 'Escape') terminar(false, '')
      }}
      onBlur={(e) => terminar(true, e.target.value)}
    />
  )
}

export function Vender({ onVoltar }: { onVoltar: () => void }): React.JSX.Element {
  const [venda, setVenda] = useState<Venda | null>(null)
  /** Venda recém-finalizada: mostra o troco até o próximo item. */
  const [finalizada, setFinalizada] = useState<Venda | null>(null)
  /** Item que acabou de ser cancelado: fica em destaque alguns segundos para o cliente ver. */
  const [recemCancelado, setRecemCancelado] = useState<ItemVenda | null>(null)
  const [selecionado, setSelecionado] = useState(-1)
  /** Último item lançado ou somado (bipar de novo o mesmo produto soma na linha que já existe). */
  const [ultimoId, setUltimoId] = useState<number | null>(null)
  const [codigo, setCodigo] = useState('')
  const [modal, setModal] = useState<Modal | null>(null)
  const [aviso, setAviso] = useState<{ erro: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [caixa, setCaixa] = useState<ResumoCaixa | null | undefined>(undefined)
  const campo = useRef<HTMLInputElement>(null)
  const corpo = useRef<HTMLTableSectionElement>(null)

  const itens = venda?.itens ?? []
  const temItens = itens.some((i) => !i.cancelado)
  const ativos = itens.filter((i) => !i.cancelado)
  const itensValidos = ativos.length
  const cancelados = itens.length - ativos.length
  const item = itens[selecionado] ?? null
  // Para o cliente: o item que acabou de passar (ou o que acabou de sair, por alguns segundos).
  const destaque = recemCancelado ?? ativos.find((i) => i.id === ultimoId) ?? ativos.at(-1) ?? null
  // Subtotal antes de qualquer desconto; descontos dos itens + o da venda = o que o cliente economizou.
  const bruto = ativos.reduce((s, i) => s + i.totalBruto, 0)
  const economia = venda ? Math.max(0, bruto - venda.subtotal + venda.desconto) : 0
  const acrescimo = venda?.acrescimo ?? 0

  // Perguntar a tabela a cada item (Configurações → tabela de preço). Ref: lido dentro de callbacks.
  const perguntarTabela = useRef(true)
  useEffect(() => {
    window.pdv.precos
      .configAPrazo()
      .then((c) => (perguntarTabela.current = c.perguntar))
      .catch(() => (perguntarTabela.current = false))
  }, [])

  // Retoma a venda que estava aberta (inclusive depois de uma queda do PDV).
  useEffect(() => {
    Promise.all([window.pdv.caixa.paraVender(), window.pdv.vendas.atual()])
      .then(([c, v]) => {
        setCaixa(c)
        if (!v) return
        atualizar(v)
        setAviso({ erro: false, texto: `Venda nº ${v.id} retomada.` })
      })
      .catch((e: unknown) => falhar(mensagemErro(e)))
  }, [])

  useEffect(() => {
    // Abrir qualquer ação significa que o operador já viu o aviso anterior.
    if (modal) setAviso(null)
    else campo.current?.focus()
  }, [modal])

  useEffect(() => {
    corpo.current?.children[selecionado]?.scrollIntoView({ block: 'nearest' })
  }, [selecionado, itens.length])

  function atualizar(v: Venda | null, selecionarUltimo = true): void {
    setVenda(v)
    if (v && selecionarUltimo) setSelecionado(v.itens.length - 1)
    if (!v) setSelecionado(-1)
  }

  function falhar(texto: string): void {
    bipeErro()
    setAviso({ erro: true, texto })
  }

  async function executar(acao: () => Promise<void>): Promise<void> {
    if (ocupado) return
    setOcupado(true)
    try {
      await acao()
    } catch (e) {
      falhar(mensagemErro(e))
    } finally {
      setOcupado(false)
    }
  }

  function itemAdicionado(v: Venda): void {
    const antes = venda?.id === v.id ? venda.itens : []
    // Linha nova ou linha que já existia e teve a quantidade somada.
    const novo = v.itens.find((i) => !antes.some((a) => a.id === i.id))
    const alvo =
      novo ?? v.itens.find((i) => i.quantidade !== antes.find((a) => a.id === i.id)?.quantidade) ?? v.itens.at(-1)
    setVenda(v)
    setSelecionado(alvo ? v.itens.indexOf(alvo) : v.itens.length - 1)
    setUltimoId(alvo?.id ?? null)
    setFinalizada(null)
    setRecemCancelado(null)
    setAviso(null)
    // A tabela se escolhe uma vez por linha: somar na linha não pergunta de novo.
    if (novo && perguntarTabela.current) void abrirTabela(novo, false)
  }

  /**
   * Janela da tabela de preço do item (PROMOCIONAL ou NORMAL). Só abre quando o produto tem
   * preço NORMAL diferente; `avisar` = o operador pediu (F4) e deve saber se não houver.
   */
  async function abrirTabela(alvo: ItemVenda, avisar: boolean): Promise<void> {
    try {
      const opcoes = await window.pdv.vendas.opcoesTabela(alvo.id)
      if (opcoes) setModal({ tipo: 'tabela', item: alvo })
      else if (avisar) falhar('Este item não tem preço NORMAL diferente do PROMOCIONAL')
    } catch (e) {
      falhar(mensagemErro(e))
    }
  }

  useEffect(() => {
    if (!recemCancelado) return
    const t = setTimeout(() => setRecemCancelado(null), 5000)
    return () => clearTimeout(t)
  }, [recemCancelado])

  const lancarCodigo = (): Promise<void> =>
    executar(async () => {
      if (!codigo.trim()) return
      const entrada = lerEntradaCaixa(codigo)
      setCodigo('')
      if (!entrada) throw new Error('Entrada inválida. Use o código ou quantidade*código (ex.: 3*789...)')
      const r = await window.pdv.vendas.adicionarCodigo(entrada.codigo, entrada.quantidade)
      if (r.tipo === 'adicionado') itemAdicionado(r.venda)
      else if (r.tipo === 'pedirQuantidade') setModal({ tipo: 'peso', produto: r.produto })
      else if (r.tipo === 'pedirPreco') setModal({ tipo: 'precoLivre', produto: r.produto, quantidade: r.quantidade })
      else falhar(`Código ${r.codigo} não encontrado. F2 busca pelo nome.`)
    })

  async function escolherNaBusca(produto: Produto): Promise<void> {
    if (produto.precoLivre) {
      setModal({ tipo: 'precoLivre', produto, quantidade: 1000 })
      return
    }
    if (produto.unidade === 'KG') {
      setModal({ tipo: 'peso', produto })
      return
    }
    setModal(null)
    await executar(async () => itemAdicionado(await window.pdv.vendas.adicionarProduto(produto.id, 1000)))
  }

  function exigirItem(): ItemVenda | null {
    if (!item) {
      falhar('Nenhum item selecionado')
      return null
    }
    if (item.cancelado) {
      falhar(`Item ${item.sequencia} já está cancelado`)
      return null
    }
    return item
  }

  /** Venda do último cupom: a recém-finalizada ou a última do banco. */
  async function vendaDoUltimoCupom(): Promise<number> {
    if (finalizada) return finalizada.id
    const ultima = await window.pdv.vendas.ultimaFinalizada()
    if (!ultima) throw new Error('Nenhuma venda finalizada ainda')
    return ultima.id
  }

  const reimprimir = (vendaId?: number): Promise<void> =>
    executar(async () => {
      const id = vendaId ?? (await vendaDoUltimoCupom())
      await window.pdv.hardware.imprimirVenda(id)
      setAviso({ erro: false, texto: `Cupom da venda nº ${id} enviado para a impressora.` })
    })

  const verCupom = (): Promise<void> =>
    executar(async () => {
      const id = await vendaDoUltimoCupom()
      setModal({ tipo: 'previa', vendaId: id, documento: await window.pdv.hardware.previa('venda', id) })
    })

  async function abrirCancelarUltima(): Promise<void> {
    if (temItens) {
      falhar('Termine ou cancele a venda atual (F8) antes')
      return
    }
    await executar(async () => {
      const ultima = await window.pdv.vendas.ultimaFinalizada()
      if (!ultima) throw new Error('Nenhuma venda finalizada para cancelar')
      setModal({ tipo: 'cancelarUltima', venda: ultima })
    })
  }

  const focarCodigo = (): void => campo.current?.focus()

  function editarQuantidade(i: ItemVenda, texto: string): void {
    const q = lerQuantidade(texto)
    if (q === null || q <= 0) {
      falhar('Quantidade inválida')
      return
    }
    if (q === i.quantidade) return
    void executar(async () => atualizar(await window.pdv.vendas.alterarQuantidade(i.id, q), false))
  }

  function editarDesconto(i: ItemVenda, texto: string): void {
    const d = lerDesconto(texto || '0', i.totalBruto)
    if (d === null) {
      falhar('Desconto inválido. Use reais (2,50) ou porcentagem (10%)')
      return
    }
    if (d === i.desconto) return
    void executar(async () => atualizar(await window.pdv.vendas.descontoItem(i.id, d), false))
  }

  /** Atalhos e botões da barra chamam as mesmas ações. */
  const acoes: Record<string, () => void> = {
    F2: () => setModal({ tipo: 'busca' }),
    F3: () => setModal({ tipo: 'cliente' }),
    F4: () => {
      if (exigirItem()) void abrirTabela(item!, true)
    },
    F5: () => {
      if (exigirItem()) setModal({ tipo: 'descontoItem', item: item! })
    },
    F6: () => (temItens ? setModal({ tipo: 'descontoVenda' }) : falhar('Venda sem itens')),
    F1: () => (temItens ? setModal({ tipo: 'acrescimoVenda' }) : falhar('Venda sem itens')),
    F7: () => {
      if (exigirItem()) setModal({ tipo: 'cancelarItem', item: item! })
    },
    F8: () => (venda ? setModal({ tipo: 'cancelarVenda' }) : falhar('Nenhuma venda em andamento')),
    F9: () => void abrirCancelarUltima(),
    F10: () => (temItens ? setModal({ tipo: 'pagamento' }) : falhar('Venda sem itens')),
    F11: () => void verCupom(),
    F12: () => void reimprimir(),
    Escape: onVoltar
  }

  useTeclas(
    {
      ...acoes,
      // Enter com código lança o item; com o campo vazio (e itens na venda) abre o pagamento.
      Enter: () => (codigo.trim() ? void lancarCodigo() : temItens && setModal({ tipo: 'pagamento' })),
      ArrowUp: () => setSelecionado((s) => Math.max(0, s - 1)),
      ArrowDown: () => setSelecionado((s) => Math.min(itens.length - 1, s + 1))
    },
    modal === null && !!caixa
  )

  useTeclas({ Escape: onVoltar }, caixa === null)

  if (caixa === null) {
    return (
      <main className="pagina pagina-estreita">
        <section className="secao">
          <h2>Caixa fechado</h2>
          <p>Para vender, abra o caixa: volte à tela inicial (Esc) e tecle F4.</p>
          <div className="acoes">
            <span className="espaco" />
            <button className="primario" onClick={onVoltar}>
              <kbd>Esc</kbd> Voltar
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="caixa">
      <label className="caixa-codigo">
        <Icone nome="codigo" tamanho={28} />
        <input
          ref={campo}
          value={codigo}
          inputMode="numeric"
          autoComplete="off"
          aria-label="Código (ou quantidade*código)"
          onChange={(e) => setCodigo(e.target.value)}
          onBlur={(e) => {
            // Volta o foco para o leitor, menos quando o operador está editando uma célula.
            if (!modal && !(e.relatedTarget instanceof HTMLInputElement)) setTimeout(focarCodigo, 0)
          }}
        />
        <span className="caixa-codigo-dica">
          Bipe ou digite o código · <b>3*código</b> multiplica · Enter vazio vai ao pagamento
        </span>
      </label>

      <nav className="caixa-acoes">
        {GRUPOS.map((g) => (
          <div key={g.nome} className={`caixa-grupo caixa-grupo-${g.nome.toLowerCase()}`}>
            <span className="caixa-grupo-nome">{g.nome}</span>
            {g.botoes.map((b) => (
              <button
                key={b.tecla}
                className={b.perigo ? 'acao-perigo' : undefined}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => acoes[b.tecla]!()}
              >
                <kbd>{b.tecla}</kbd> {b.rotulo}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <section className="caixa-itens">
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Descrição</th>
                <th className="num">Qtd</th>
                <th className="num">Preço</th>
                <th className="num">Desc.</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody ref={corpo}>
              {itens.map((i, indice) => (
                <tr
                  key={i.id}
                  className={[indice === selecionado && 'selecionada', i.cancelado && 'cancelado'].filter(Boolean).join(' ')}
                  onClick={() => setSelecionado(indice)}
                >
                  <td className="caixa-seq">{i.sequencia}</td>
                  <td>
                    <span className="caixa-desc">{i.descricao}</span>
                    {i.tipoPreco === 'promocao' && <span className="etiqueta oferta">oferta</span>}
                    {i.tipoPreco === 'atacado' && <span className="etiqueta oferta">atacado</span>}
                  </td>
                  <td className="num">
                    <CelulaEditavel
                      texto={qtd(i.quantidade, i.unidade)}
                      inicial={quantidadeParaTexto(i.quantidade, i.unidade)}
                      editavel={!i.cancelado && i.tipoPreco !== 'etiqueta'}
                      onSalvar={(t) => editarQuantidade(i, t)}
                      onFim={focarCodigo}
                    />
                  </td>
                  <td className="num">{formatarMoeda(i.precoUnitario)}</td>
                  <td className="num caixa-col-desc">
                    <CelulaEditavel
                      texto={i.desconto ? `−${formatarMoeda(i.desconto)}` : ''}
                      inicial={i.desconto ? centavosParaTexto(i.desconto) : ''}
                      editavel={!i.cancelado}
                      onSalvar={(t) => editarDesconto(i, t)}
                      onFim={focarCodigo}
                    />
                  </td>
                  <td className="num">{formatarMoeda(i.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {itens.length === 0 &&
            (finalizada ? (
              <div className="caixa-obrigado">
                <strong>Obrigado pela preferência!</strong>
                <span>
                  Venda nº {finalizada.id} ·{' '}
                  {finalizada.pagamentos.map((p) => `${FORMAS_PAGAMENTO[p.forma]} ${formatarMoeda(p.valor)}`).join(' + ')}
                </span>
              </div>
            ) : (
              <div className="caixa-vazio">
                <Icone nome="carrinho" tamanho={40} />
                <strong>Caixa livre</strong>
                <span>Bipe um produto para começar.</span>
              </div>
            ))}
        </div>
        {aviso ? (
          <p className={`caixa-aviso ${aviso.erro ? 'caixa-aviso-erro' : ''}`} key={aviso.texto}>
            <Icone nome={aviso.erro ? 'erro' : 'ok'} />
            {aviso.texto}
          </p>
        ) : (
          itens.length > 0 && (
            <p className="caixa-aviso caixa-aviso-neutro">
              <b>
                {itensValidos} {itensValidos === 1 ? 'item' : 'itens'}
              </b>
              {cancelados > 0 && ` · ${cancelados} ${cancelados === 1 ? 'cancelado' : 'cancelados'}`}
              {economia > 0 && (
                <span className="caixa-economia">
                  você economizou <b>{formatarMoeda(economia)}</b>
                </span>
              )}
            </p>
          )
        )}
        {modal?.tipo === 'tabela' && (
          <EscolhaTabela
            descricao={modal.item.descricao}
            quantidade={qtd(modal.item.quantidade, modal.item.unidade)}
            atual={modal.item.tabela}
            onEscolher={(tabela) => {
              setModal(null)
              if (tabela !== modal.item.tabela) {
                void executar(async () => atualizar(await window.pdv.vendas.alterarTabelaItem(modal.item.id, tabela), false))
              }
            }}
            onDigito={(c) => {
              // Bipou o próximo produto sem responder: fica na tabela atual e o código segue.
              setModal(null)
              setCodigo((atual) => atual + c)
            }}
            onFechar={() => setModal(null)}
          />
        )}
      </section>

      <aside className="caixa-painel">
        {finalizada && !venda ? (
          <>
            <div className="painel-cartao caixa-finalizada">
              <span className="cartao-rotulo">Venda nº {finalizada.id} finalizada</span>
              <div className="linha-total">
                <span>Total</span>
                <b>{formatarMoeda(finalizada.total)}</b>
              </div>
              {finalizada.pagamentos.map((p) => (
                <div key={p.id} className="linha-total">
                  <span>{FORMAS_PAGAMENTO[p.forma]}</span>
                  <b>{formatarMoeda(p.valor)}</b>
                </div>
              ))}
            </div>
            {finalizada.saldoDevedor > 0 ? (
              <div className="caixa-total caixa-saldo">
                <span>Saldo devedor</span>
                <strong>{formatarMoeda(finalizada.saldoDevedor)}</strong>
              </div>
            ) : finalizada.troco > 0 ? (
              <div className="caixa-total caixa-troco">
                <span>Seu troco</span>
                <strong>{formatarMoeda(finalizada.troco)}</strong>
              </div>
            ) : (
              <div className="caixa-total caixa-pago">
                <span>Pagamento recebido</span>
                <strong>
                  <Icone nome="ok" tamanho={44} /> Pago
                </strong>
              </div>
            )}
          </>
        ) : (
          <>
            <div
              // A chave muda a cada bipe (ou mudança de quantidade): o cartão "pisca" para o cliente ver.
              key={destaque ? `${destaque.id}-${destaque.quantidade}-${destaque.total}-${!!recemCancelado}` : 'vazio'}
              className={`painel-cartao caixa-item ${recemCancelado ? 'caixa-item-cancelado' : 'caixa-item-novo'}`}
            >
              <span className="cartao-rotulo">{recemCancelado ? 'Item cancelado' : 'Acabou de passar'}</span>
              {destaque ? (
                <>
                  <strong>{destaque.descricao}</strong>
                  <div className="caixa-item-linha">
                    <span>
                      {qtd(destaque.quantidade, destaque.unidade)} × {formatarMoeda(destaque.precoUnitario)}
                      {destaque.desconto > 0 && !recemCancelado && (
                        <em className="caixa-item-desconto"> −{formatarMoeda(destaque.desconto)}</em>
                      )}
                    </span>
                    <b>
                      {recemCancelado && '−'}
                      {formatarMoeda(destaque.total)}
                    </b>
                  </div>
                </>
              ) : (
                <span className="dica">Nenhum item ainda</span>
              )}
            </div>
            <div className="painel-cartao caixa-resumo">
              <div className="linha-total">
                <span>
                  Subtotal ({itensValidos} {itensValidos === 1 ? 'item' : 'itens'})
                </span>
                <b>{formatarMoeda(bruto)}</b>
              </div>
              {economia > 0 && (
                <div className="linha-total caixa-desconto">
                  <span>Descontos</span>
                  <b>−{formatarMoeda(economia)}</b>
                </div>
              )}
              {acrescimo > 0 && (
                <div className="linha-total caixa-acrescimo">
                  <span>Acréscimo</span>
                  <b>+{formatarMoeda(acrescimo)}</b>
                </div>
              )}
            </div>
            <div className="caixa-total">
              <span>Total a pagar</span>
              <strong>{formatarMoeda(venda?.total ?? 0)}</strong>
            </div>
            <button
              className="caixa-pagar"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => acoes['F10']!()}
            >
              <kbd>Enter</kbd> Pagamento
            </button>
            {venda?.clienteNome && (
              <p className="caixa-cliente">
                <Icone nome="pessoa" />
                Cliente: {venda.clienteNome}
              </p>
            )}
          </>
        )}

        <p className="dica caixa-dica">
          Clique na quantidade ou no desconto de um item para corrigir. Esc volta ao início e a venda fica salva.
        </p>
      </aside>

      {modal?.tipo === 'busca' && <BuscaProduto onEscolher={(p) => void escolherNaBusca(p)} onFechar={() => setModal(null)} />}

      {modal?.tipo === 'peso' && (
        <PesoBalanca
          produto={modal.produto}
          confirmar={async (q) => {
            itemAdicionado(await window.pdv.vendas.adicionarProduto(modal.produto.id, q))
            setModal(null)
            return null
          }}
          onFechar={() => setModal(null)}
        />
      )}

      {modal?.tipo === 'precoLivre' && (
        <Prompt
          titulo={modal.produto.descricao}
          rotulo={modal.quantidade === 1000 ? 'Valor (R$)' : `Valor de cada um (R$) · ${qtd(modal.quantidade, 'UN')} un`}
          dica="Digite o valor e Enter. Esc desiste."
          confirmar={async (texto) => {
            const valor = lerMoeda(texto)
            if (valor === null || valor <= 0) return 'Valor inválido'
            itemAdicionado(await window.pdv.vendas.adicionarProduto(modal.produto.id, modal.quantidade, valor))
            setModal(null)
            return null
          }}
          onFechar={() => setModal(null)}
        />
      )}

      {modal?.tipo === 'cliente' && (
        <BuscaCliente
          onEscolher={(c) => {
            setModal(null)
            void executar(async () => {
              atualizar(await window.pdv.vendas.definirCliente(c.id), false)
              setFinalizada(null)
            })
          }}
          onSemCliente={() => {
            setModal(null)
            void executar(async () => atualizar(await window.pdv.vendas.definirCliente(null), false))
          }}
          onFechar={() => setModal(null)}
        />
      )}

      {modal?.tipo === 'previa' && (
        <PreviaCupom
          titulo={`Cupom da venda nº ${modal.vendaId}`}
          documento={modal.documento}
          onImprimir={() => {
            setModal(null)
            void reimprimir(modal.vendaId)
          }}
          onFechar={() => setModal(null)}
        />
      )}

      {modal?.tipo === 'descontoItem' && (
        <Prompt
          titulo={`Desconto no item ${modal.item.sequencia}`}
          rotulo={`${modal.item.descricao} · ${formatarMoeda(modal.item.totalBruto)}`}
          dica="Em reais (2,50) ou porcentagem (10%). 0 tira o desconto."
          inicial={modal.item.desconto ? centavosParaTexto(modal.item.desconto) : ''}
          confirmar={async (texto) => {
            const d = lerDesconto(texto, modal.item.totalBruto)
            if (d === null) return 'Desconto inválido'
            atualizar(await window.pdv.vendas.descontoItem(modal.item.id, d), false)
            setModal(null)
            return null
          }}
          onFechar={() => setModal(null)}
        />
      )}

      {modal?.tipo === 'descontoVenda' && venda && (
        <DescontoVenda
          subtotal={venda.subtotal}
          descontoAtual={venda.desconto}
          confirmar={async (d) => {
            atualizar(await window.pdv.vendas.descontoVenda(d), false)
            setModal(null)
            return null
          }}
          onFechar={() => setModal(null)}
        />
      )}

      {modal?.tipo === 'acrescimoVenda' && venda && (
        <AcrescimoVenda
          base={venda.subtotal - venda.desconto}
          acrescimoAtual={venda.acrescimo}
          confirmar={async (a) => {
            atualizar(await window.pdv.vendas.acrescimoVenda(a), false)
            setModal(null)
            return null
          }}
          onFechar={() => setModal(null)}
        />
      )}

      {modal?.tipo === 'cancelarItem' && (
        <Confirmar
          titulo={`Cancelar item ${modal.item.sequencia}?`}
          mensagem={`${modal.item.descricao} · ${formatarMoeda(modal.item.total)}`}
          rotuloSim="Cancelar item"
          onSim={async () => {
            atualizar(await window.pdv.vendas.cancelarItem(modal.item.id), false)
            setRecemCancelado(modal.item)
            setModal(null)
          }}
          onFechar={() => setModal(null)}
        />
      )}

      {modal?.tipo === 'cancelarVenda' && venda && (
        <Confirmar
          titulo={`Cancelar a venda nº ${venda.id}?`}
          mensagem={`${venda.itens.filter((i) => !i.cancelado).length} itens · ${formatarMoeda(venda.total)}. Os pagamentos lançados também são descartados.`}
          rotuloSim="Cancelar venda"
          onSim={async () => {
            await window.pdv.vendas.cancelar()
            atualizar(null)
            setAviso({ erro: false, texto: `Venda nº ${venda.id} cancelada.` })
            setModal(null)
          }}
          onFechar={() => setModal(null)}
        />
      )}

      {modal?.tipo === 'cancelarUltima' && (
        <Confirmar
          titulo={`Cancelar a venda finalizada nº ${modal.venda.id}?`}
          mensagem={
            <>
              <p>
                {modal.venda.itens.filter((i) => !i.cancelado).length} itens · {formatarMoeda(modal.venda.total)} ·{' '}
                {modal.venda.pagamentos.map((p) => FORMAS_PAGAMENTO[p.forma]).join(' + ')}
              </p>
              <p className="dica">Os itens voltam ao estoque. Devolva o dinheiro ou estorne o cartão/Pix.</p>
            </>
          }
          rotuloSim="Cancelar venda"
          onSim={async () => {
            const cancelada = await window.pdv.vendas.cancelarFinalizada(modal.venda.id)
            setFinalizada(null)
            setAviso({ erro: false, texto: `Venda nº ${cancelada.id} cancelada. Estoque devolvido.` })
            setModal(null)
          }}
          onFechar={() => setModal(null)}
        />
      )}

      {modal?.tipo === 'pagamento' && venda && (
        <Pagamento
          venda={venda}
          onAtualizar={(v) => atualizar(v, false)}
          onFinalizada={(v) => {
            atualizar(null)
            setFinalizada(v)
            setAviso(null)
            setModal(null)
            // Cupom e gaveta depois: falha de hardware não desfaz a venda, só avisa.
            void window.pdv.hardware.aposVenda(v.id).then((r) => {
              if (r.erro) falhar(`Venda finalizada, mas o cupom/gaveta falhou: ${r.erro}. F12 tenta imprimir de novo.`)
              else if (r.semCupomCliente) {
                setAviso({ erro: false, texto: `Cupom não impresso: ${r.semCupomCliente} está marcado para não imprimir. F12 imprime.` })
              }
            })
          }}
          onFechar={() => setModal(null)}
        />
      )}
    </main>
  )
}
