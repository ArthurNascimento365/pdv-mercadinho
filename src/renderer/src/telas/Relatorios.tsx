import { useEffect, useState } from 'react'
import { formatarMoeda, quantidadeParaTexto } from '@shared/dinheiro'
import type { Diagramado } from '@shared/impressao'
import { periodoPadrao, type Periodo, type VendaConsulta } from '@shared/relatorios'
import { FORMAS_PAGAMENTO } from '@shared/vendas'
import { Confirmar } from '../componentes/Modais'
import { PreviaCupom } from '../componentes/PreviaCupom'
import { mensagemErro, useControleEstoque, useTeclas } from '../util'

type Aba = 'vendas' | 'fechamentos' | 'margem' | 'abc' | 'fiado' | 'semGiro' | 'consulta'

const ABAS: { aba: Aba; tecla: string; nome: string; usaPeriodo: boolean }[] = [
  { aba: 'vendas', tecla: 'F1', nome: 'Vendas', usaPeriodo: true },
  { aba: 'fechamentos', tecla: 'F2', nome: 'Fechamentos', usaPeriodo: true },
  { aba: 'margem', tecla: 'F3', nome: 'Margem', usaPeriodo: true },
  { aba: 'abc', tecla: 'F4', nome: 'Curva ABC', usaPeriodo: true },
  { aba: 'fiado', tecla: 'F5', nome: 'Fiado em aberto', usaPeriodo: false },
  { aba: 'semGiro', tecla: 'F6', nome: 'Sem giro (30 dias)', usaPeriodo: false },
  { aba: 'consulta', tecla: 'F7', nome: 'Consultar vendas', usaPeriodo: true }
]

type ModalConsulta = { tipo: 'previa'; id: number; documento: Diagramado } | { tipo: 'cancelar'; venda: VendaConsulta } | null

/** Tabela pronta para a tela e para o CSV (mesmos textos). */
interface Tabela {
  resumo: { rotulo: string; valor: string; alerta?: boolean }[]
  cabecalho: string[]
  /** Índices das colunas numéricas (alinhadas à direita). */
  numericas: number[]
  linhas: { celulas: string[]; alerta?: boolean }[]
  nota?: string
  /** Consultar vendas: as vendas das linhas, na mesma ordem (para abrir, reimprimir e cancelar). */
  vendas?: VendaConsulta[]
}

const real = formatarMoeda
const pct = (v: number | null): string => (v === null ? '—' : `${v.toFixed(1).replace('.', ',')}%`)
const dataBr = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')
const dataHora = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
const diaBr = (dia: string): string => dia.split('-').reverse().join('/')

async function montar(aba: Aba, periodo: Periodo, numero: number | null): Promise<Tabela> {
  const r = window.pdv.relatorios
  switch (aba) {
    case 'vendas': {
      const v = await r.vendas(periodo)
      return {
        resumo: [
          { rotulo: 'Vendas', valor: String(v.quantidade) },
          { rotulo: 'Faturamento', valor: real(v.faturamento) },
          { rotulo: 'Ticket médio', valor: real(v.ticketMedio) },
          { rotulo: 'Descontos', valor: real(v.descontos) },
          ...(v.acrescimos > 0 ? [{ rotulo: 'Acréscimos', valor: real(v.acrescimos) }] : []),
          { rotulo: 'Canceladas', valor: String(v.canceladas), alerta: v.canceladas > 0 },
          ...v.porForma.map((f) => ({ rotulo: FORMAS_PAGAMENTO[f.forma], valor: real(f.valor) })),
          ...(v.saldoDevedor > 0 ? [{ rotulo: 'Saldo devedor (em aberto)', valor: real(v.saldoDevedor), alerta: true }] : [])
        ],
        cabecalho: ['Dia', 'Vendas', 'Total'],
        numericas: [1, 2],
        linhas: v.porDia.map((d) => ({ celulas: [diaBr(d.dia), String(d.quantidade), real(d.total)] }))
      }
    }
    case 'fechamentos': {
      const f = await r.fechamentos(periodo)
      const dif = f.reduce((s, l) => s + l.diferenca, 0)
      return {
        resumo: [
          { rotulo: 'Fechamentos', valor: String(f.length) },
          { rotulo: 'Diferença total', valor: real(dif), alerta: dif < 0 }
        ],
        cabecalho: ['Caixa', 'Operador', 'Aberto', 'Fechado', 'Vendido', 'Esperado', 'Contado', 'Diferença'],
        numericas: [0, 4, 5, 6, 7],
        linhas: f.map((l) => ({
          celulas: [String(l.caixaId), l.operador, dataHora(l.abertoEm), dataHora(l.fechadoEm), real(l.vendido), real(l.esperado), real(l.contado), real(l.diferenca)],
          alerta: l.diferenca < 0
        }))
      }
    }
    case 'margem': {
      const m = await r.margem(periodo)
      const linha = (l: (typeof m.produtos)[number], comCategoria: boolean): string[] => [
        l.descricao + (l.semCusto ? ' *' : ''),
        ...(comCategoria ? [l.categoria ?? ''] : []),
        l.unidade ? quantidadeParaTexto(l.quantidade, l.unidade) : '',
        real(l.receita),
        real(l.custo),
        real(l.lucro),
        pct(l.margem)
      ]
      return {
        resumo: [
          { rotulo: 'Receita', valor: real(m.total.receita) },
          { rotulo: 'Custo', valor: real(m.total.custo) },
          { rotulo: 'Lucro bruto', valor: real(m.total.lucro) },
          { rotulo: 'Margem', valor: pct(m.total.margem) },
          ...m.categorias.map((c) => ({ rotulo: c.descricao, valor: `${real(c.lucro)} · ${pct(c.margem)}` }))
        ],
        cabecalho: ['Produto', 'Categoria', 'Qtd', 'Receita', 'Custo', 'Lucro', 'Margem'],
        numericas: [2, 3, 4, 5, 6],
        linhas: m.produtos.map((l) => ({ celulas: linha(l, true), alerta: (l.margem ?? 0) < 0 })),
        nota: m.total.semCusto ? '* Produto vendido sem custo cadastrado: o lucro dele aparece maior que o real.' : undefined
      }
    }
    case 'abc': {
      const a = await r.abc(periodo)
      const conta = (c: string) => a.filter((l) => l.classe === c).length
      return {
        resumo: [
          { rotulo: 'Classe A (80% do faturamento)', valor: `${conta('A')} produtos` },
          { rotulo: 'Classe B (próximos 15%)', valor: `${conta('B')} produtos` },
          { rotulo: 'Classe C (últimos 5%)', valor: `${conta('C')} produtos` }
        ],
        cabecalho: ['Classe', 'Produto', 'Faturamento', 'Participação', 'Acumulado'],
        numericas: [2, 3, 4],
        linhas: a.map((l) => ({ celulas: [l.classe, l.descricao, real(l.receita), pct(l.participacao), pct(l.acumulado)] })),
        nota: 'Classe A: o que não pode faltar na prateleira.'
      }
    }
    case 'fiado': {
      const f = await r.fiado()
      return {
        resumo: [
          { rotulo: 'A receber', valor: real(f.totalAReceber) },
          { rotulo: `Em atraso (> ${f.diasAtraso} dias)`, valor: real(f.totalAtrasado), alerta: f.totalAtrasado > 0 },
          { rotulo: 'Clientes devendo', valor: String(f.clientes.length) }
        ],
        cabecalho: ['Cliente', 'Telefone', 'Saldo', 'Limite', 'Em aberto há', 'Situação'],
        numericas: [2, 3, 4],
        linhas: f.clientes.map((c) => ({
          celulas: [c.nome, c.telefone ?? '', real(c.saldo), real(c.limite), c.diasEmAberto === null ? '—' : `${c.diasEmAberto} dias`, c.atrasado ? 'ATRASADO' : 'em dia'],
          alerta: c.atrasado
        }))
      }
    }
    case 'semGiro': {
      const s = await r.semGiro(30)
      const parado = s.reduce((t, l) => t + (l.valorParado ?? 0), 0)
      return {
        resumo: [
          { rotulo: 'Produtos sem venda há 30 dias', valor: String(s.length) },
          { rotulo: 'Dinheiro parado (custo)', valor: real(parado), alerta: parado > 0 }
        ],
        cabecalho: ['Produto', 'Categoria', 'Estoque', 'Última venda', 'Valor parado'],
        numericas: [2, 4],
        linhas: s.map((l) => ({
          celulas: [l.descricao, l.categoria ?? '', quantidadeParaTexto(l.estoque, l.unidade), l.ultimaVenda ? dataBr(l.ultimaVenda) : 'nunca', l.valorParado === null ? 'sem custo' : real(l.valorParado)]
        })),
        nota: 'Bons candidatos a promoção ou queima de estoque.'
      }
    }
    case 'consulta': {
      const vendas = await r.consultarVendas({ periodo, numero })
      const fechadas = vendas.filter((v) => v.status === 'finalizada')
      const saldo = fechadas.reduce((t, v) => t + v.saldoDevedor, 0)
      return {
        resumo: [
          { rotulo: 'Vendas finalizadas', valor: String(fechadas.length) },
          { rotulo: 'Total', valor: real(fechadas.reduce((t, v) => t + v.total, 0)) },
          { rotulo: 'Canceladas', valor: String(vendas.length - fechadas.length), alerta: vendas.length > fechadas.length },
          { rotulo: 'Saldo devedor', valor: real(saldo), alerta: saldo > 0 }
        ],
        cabecalho: ['Nº', 'Data', 'Operador', 'Itens', 'Pagamento', 'Total', 'Saldo devedor', 'Situação'],
        numericas: [0, 3, 5, 6],
        linhas: vendas.map((v) => ({
          celulas: [
            String(v.id),
            dataHora(v.data),
            v.operador ?? '',
            String(v.itens),
            [...new Set(v.formas)].map((f) => FORMAS_PAGAMENTO[f]).join(' + '),
            real(v.total),
            v.saldoDevedor > 0 ? real(v.saldoDevedor) : '',
            v.status === 'cancelada' ? 'Cancelada' : 'Finalizada'
          ],
          alerta: v.status === 'cancelada'
        })),
        nota:
          vendas.length === 500
            ? 'Mostrando as 500 mais recentes: diminua o período ou busque pelo número.'
            : '↑ ↓ escolhe · Enter abre o cupom · F12 reimprime · F8 cancela (só venda do caixa aberto agora).',
        vendas
      }
    }
  }
}

export function Relatorios({ onVoltar }: { onVoltar: () => void }): React.JSX.Element {
  const [aba, setAba] = useState<Aba>('vendas')
  // "Sem giro" depende do estoque: some quando o controle de estoque está desligado.
  const controleEstoque = useControleEstoque()
  const abas = controleEstoque === false ? ABAS.filter((a) => a.aba !== 'semGiro') : ABAS
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoPadrao('hoje'))
  const [tabela, setTabela] = useState<Tabela | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // Consultar vendas: número digitado (busca em qualquer data), linha escolhida e janelas.
  const [numero, setNumero] = useState('')
  const [selecionada, setSelecionada] = useState(0)
  const [modal, setModal] = useState<ModalConsulta>(null)
  const [recarga, setRecarga] = useState(0)
  const numeroBusca = aba === 'consulta' && numero ? Number(numero) : null

  useEffect(() => {
    let cancelado = false
    setErro(null)
    montar(aba, periodo, numeroBusca)
      .then((t) => {
        if (cancelado) return
        setTabela(t)
        setSelecionada((s) => Math.min(s, Math.max(0, t.linhas.length - 1)))
      })
      .catch((e: unknown) => !cancelado && setErro(mensagemErro(e)))
    return () => {
      cancelado = true
    }
  }, [aba, periodo, numeroBusca, recarga])

  const vendaSelecionada = tabela?.vendas?.[selecionada] ?? null

  async function abrirCupom(): Promise<void> {
    if (!vendaSelecionada) return
    try {
      const documento = await window.pdv.hardware.previa('venda', vendaSelecionada.id)
      setModal({ tipo: 'previa', id: vendaSelecionada.id, documento })
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }

  async function reimprimir(id: number): Promise<void> {
    try {
      await window.pdv.hardware.imprimirVenda(id)
      setAviso(`Cupom da venda nº ${id} enviado para a impressora.`)
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }

  function pedirCancelamento(): void {
    if (!vendaSelecionada) return
    if (vendaSelecionada.status === 'cancelada') setErro(`A venda nº ${vendaSelecionada.id} já está cancelada`)
    else if (!vendaSelecionada.podeCancelar) {
      setErro(`A venda nº ${vendaSelecionada.id} é de um caixa já fechado e não pode ser cancelada`)
    } else setModal({ tipo: 'cancelar', venda: vendaSelecionada })
  }

  async function exportar(): Promise<void> {
    if (!tabela) return
    const nome = ABAS.find((a) => a.aba === aba)!.nome
    const linhas = [tabela.cabecalho, ...tabela.linhas.map((l) => l.celulas.map((c) => c.replace(/ /g, ' ')))]
    try {
      if (await window.pdv.relatorios.exportarCsv(`${nome} ${periodo.de} a ${periodo.ate}`, linhas)) setAviso('Relatório exportado.')
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }

  useTeclas(
    {
      Escape: onVoltar,
      F10: () => void exportar(),
      ...Object.fromEntries(abas.map((a) => [a.tecla, () => setAba(a.aba)])),
      ...(aba === 'consulta'
        ? {
            ArrowUp: () => setSelecionada((s) => Math.max(0, s - 1)),
            ArrowDown: () => setSelecionada((s) => Math.min((tabela?.linhas.length ?? 1) - 1, s + 1)),
            Enter: () => void abrirCupom(),
            F8: pedirCancelamento,
            F12: () => vendaSelecionada && void reimprimir(vendaSelecionada.id)
          }
        : {})
    },
    modal === null
  )

  const atual = ABAS.find((a) => a.aba === aba)!

  return (
    <main className="pagina">
      <div className="barra">
        <h2>Relatórios</h2>
        {abas.map((a) => (
          <button key={a.aba} className={a.aba === aba ? 'primario' : ''} onClick={() => setAba(a.aba)}>
            <kbd>{a.tecla}</kbd> {a.nome}
          </button>
        ))}
        <span className="espaco" />
        <button onClick={() => void exportar()}>
          <kbd>F10</kbd> Exportar CSV
        </button>
        <button onClick={onVoltar}>
          <kbd>Esc</kbd> Voltar
        </button>
      </div>

      {atual.usaPeriodo && (
        <div className="barra">
          {(['hoje', 'semana', 'mes'] as const).map((t) => (
            <button key={t} onClick={() => setPeriodo(periodoPadrao(t))}>
              {t === 'hoje' ? 'Hoje' : t === 'semana' ? 'Últimos 7 dias' : 'Este mês'}
            </button>
          ))}
          <label className="opcao">
            De <input type="date" value={periodo.de} onChange={(e) => e.target.value && setPeriodo({ ...periodo, de: e.target.value })} />
          </label>
          <label className="opcao">
            até <input type="date" value={periodo.ate} onChange={(e) => e.target.value && setPeriodo({ ...periodo, ate: e.target.value })} />
          </label>
          {aba === 'consulta' && (
            <label className="opcao">
              Nº da venda
              <input
                className="campo-numero-venda"
                inputMode="numeric"
                placeholder="qualquer data"
                value={numero}
                onChange={(e) => {
                  setNumero(e.target.value.replace(/\D/g, '').slice(0, 9))
                  setSelecionada(0)
                }}
              />
            </label>
          )}
        </div>
      )}

      {aviso && <p className="aviso">{aviso}</p>}
      {erro && <p className="erro">{erro}</p>}

      {tabela && (
        <>
          <div className="cartoes cartoes-relatorio">
            {tabela.resumo.map((r) => (
              <div key={r.rotulo} className="cartao">
                <span>{r.rotulo}</span>
                <strong className={r.alerta ? 'baixo' : ''}>{r.valor}</strong>
              </div>
            ))}
          </div>
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  {tabela.cabecalho.map((c, i) => (
                    <th key={c} className={tabela.numericas.includes(i) ? 'num' : ''}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tabela.linhas.map((l, i) => (
                  <tr
                    key={i}
                    className={tabela.vendas ? [i === selecionada && 'selecionada', l.alerta && 'cancelado'].filter(Boolean).join(' ') : undefined}
                    onClick={tabela.vendas ? () => setSelecionada(i) : undefined}
                    onDoubleClick={tabela.vendas ? () => void abrirCupom() : undefined}
                  >
                    {l.celulas.map((c, j) => (
                      <td key={j} className={[tabela.numericas.includes(j) && 'num', l.alerta && 'baixo'].filter(Boolean).join(' ')}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {tabela.linhas.length === 0 && <p className="vazio">Nada no período.</p>}
          </div>
          {tabela.nota && <p className="dica">{tabela.nota}</p>}
        </>
      )}

      {modal?.tipo === 'previa' && (
        <PreviaCupom
          titulo={`Cupom da venda nº ${modal.id}`}
          documento={modal.documento}
          onImprimir={() => {
            setModal(null)
            void reimprimir(modal.id)
          }}
          onFechar={() => setModal(null)}
        />
      )}
      {modal?.tipo === 'cancelar' && (
        <Confirmar
          titulo={`Cancelar a venda nº ${modal.venda.id}?`}
          mensagem={
            <>
              <p>
                {modal.venda.itens} itens · {real(modal.venda.total)} ·{' '}
                {modal.venda.formas.map((f) => FORMAS_PAGAMENTO[f]).join(' + ')}
              </p>
              <p className="dica">Os itens voltam ao estoque. Devolva o dinheiro ou estorne o cartão/Pix.</p>
            </>
          }
          rotuloSim="Cancelar venda"
          onSim={async () => {
            await window.pdv.vendas.cancelarFinalizada(modal.venda.id)
            setModal(null)
            setAviso(`Venda nº ${modal.venda.id} cancelada.`)
            setRecarga((n) => n + 1)
          }}
          onFechar={() => setModal(null)}
        />
      )}
    </main>
  )
}
