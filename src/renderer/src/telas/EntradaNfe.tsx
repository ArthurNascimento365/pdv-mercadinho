import { useEffect, useRef, useState } from 'react'
import { centavosParaTexto, formatarMoeda, lerMoeda, quantidadeParaTexto } from '@shared/dinheiro'
import {
  custoUnitario,
  quantidadeEntrada,
  unidadeVenda,
  type DecisaoItem,
  type ItemNota,
  type PreviaEntrada,
  type ResumoEntrada
} from '@shared/estoque'
import type { Produto } from '@shared/produtos'
import { BuscaProduto, Prompt } from '../componentes/Modais'
import { mensagemErro, textoMargem, useTeclas } from '../util'
import { FormProduto } from './FormProduto'

interface Linha {
  item: ItemNota
  produto: Produto | null
  origem: 'vinculo' | 'ean' | 'eanTributavel' | 'manual' | null
  fator: number
  precoVenda: number | null
  ignorado: boolean
  /** Validade digitada (AAAA-MM-DD) quando a nota não traz. */
  validade: string | null
}

type Modal = 'busca' | 'criar' | 'fator' | 'preco' | 'validade' | null

/** "31/12/2026" → "2026-12-31"; null se inválida. */
function lerData(texto: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(texto.trim())
  if (!m) return null
  const [, d = '', me = '', a = ''] = m
  const ano = a.length === 2 ? `20${a}` : a
  const iso = `${ano}-${me.padStart(2, '0')}-${d.padStart(2, '0')}`
  const data = new Date(`${iso}T00:00:00`)
  return data.getDate() === Number(d) && data.getMonth() + 1 === Number(me) ? iso : null
}

const ORIGENS = { vinculo: 'código do fornecedor', ean: 'EAN', eanTributavel: 'EAN da unidade', manual: 'escolhido' }

const qtdNota = (q: number): string => (q / 10_000).toLocaleString('pt-BR', { maximumFractionDigits: 4 })

function fatorSugerido(item: ItemNota): number {
  if (!item.eanTributavel || item.eanTributavel === item.ean || item.quantidade === 0) return 1
  return Math.round((item.quantidadeTributavel / item.quantidade) * 1000) / 1000
}

export function EntradaNfe({
  previa,
  onFechar
}: {
  previa: PreviaEntrada
  onFechar: (feita: ResumoEntrada | null) => void
}): React.JSX.Element {
  const [linhas, setLinhas] = useState<Linha[]>(() =>
    previa.itens.map((i) => ({
      item: i.item,
      produto: i.produto,
      origem: i.origem,
      fator: i.fator,
      precoVenda: null,
      ignorado: false,
      validade: null
    }))
  )
  const [sel, setSel] = useState(0)
  const [modal, setModal] = useState<Modal>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const corpo = useRef<HTMLTableSectionElement>(null)
  const linha = linhas[sel]

  useEffect(() => {
    corpo.current?.children[sel]?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const alterar = (mudanca: Partial<Linha>): void =>
    setLinhas((ls) => ls.map((l, i) => (i === sel ? { ...l, ...mudanca } : l)))

  function vincular(produto: Produto): void {
    alterar({ produto, origem: 'manual', ignorado: false, precoVenda: null })
    setModal(null)
    setErro(null)
  }

  async function confirmar(): Promise<void> {
    if (ocupado) return
    setErro(null)
    const semProduto = linhas.find((l) => !l.ignorado && !l.produto)
    if (semProduto) {
      setSel(linhas.indexOf(semProduto))
      setErro(`Item ${semProduto.item.numero} sem produto: F2 vincula, F3 cadastra ou Del ignora.`)
      return
    }
    const decisoes: DecisaoItem[] = linhas.map((l) =>
      l.ignorado || !l.produto
        ? { numero: l.item.numero, acao: 'ignorar' }
        : {
            numero: l.item.numero,
            acao: 'vincular',
            produtoId: l.produto.id,
            fator: l.fator,
            precoVenda: l.precoVenda,
            validade: l.validade
          }
    )
    setOcupado(true)
    try {
      onFechar(await window.pdv.entradas.confirmar(previa.id, decisoes))
    } catch (e) {
      setErro(mensagemErro(e))
      setOcupado(false)
    }
  }

  useTeclas(
    {
      Escape: () => onFechar(null),
      ArrowDown: () => setSel((s) => Math.min(s + 1, linhas.length - 1)),
      ArrowUp: () => setSel((s) => Math.max(s - 1, 0)),
      F2: () => setModal('busca'),
      F3: () => setModal('criar'),
      F6: () => linha?.produto && setModal('fator'),
      F7: () => linha?.produto && setModal('preco'),
      F8: () => linha?.produto && setModal('validade'),
      Delete: () => alterar({ ignorado: !linha?.ignorado }),
      F10: () => void confirmar()
    },
    modal === null
  )

  const { nota } = previa
  const aVincular = linhas.filter((l) => !l.ignorado && !l.produto).length

  return (
    <div className="fundo-modal">
      <div className="modal modal-entrada">
        <h2>
          Entrada · NF-e {nota.numero}/{nota.serie} · {nota.emitente.nomeFantasia ?? nota.emitente.razaoSocial}
        </h2>
        <p className="dica">
          {previa.arquivo} · emitida em {nota.emissao ? new Date(nota.emissao).toLocaleDateString('pt-BR') : '—'} ·
          total {formatarMoeda(nota.valorTotal)} · {nota.itens.length} itens
          {!previa.fornecedorCadastrado && ' · fornecedor novo (será cadastrado)'}
        </p>

        <div className="tabela-rolagem previa-entrada">
          <table className="tabela">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Na nota</th>
                <th className="num">Qtd nota</th>
                <th>Produto no PDV</th>
                <th className="num">Fator</th>
                <th className="num">Entra</th>
                <th className="num">Custo un.</th>
                <th className="num">Venda</th>
                <th className="num">Margem</th>
              </tr>
            </thead>
            <tbody ref={corpo}>
              {linhas.map((l, i) => {
                const entra = l.produto ? quantidadeEntrada(l.item.quantidade, l.fator) : 0
                const custo = l.produto ? custoUnitario(l.item.custoTotal, entra) : null
                const venda = l.precoVenda ?? l.produto?.precoVenda ?? null
                const fracionado = l.produto?.unidade === 'UN' && entra % 1000 !== 0
                return (
                  <tr
                    key={l.item.numero}
                    className={[i === sel && 'selecionada', l.ignorado && 'cancelado'].filter(Boolean).join(' ')}
                    onClick={() => setSel(i)}
                  >
                    <td>{l.item.numero}</td>
                    <td>
                      {l.item.descricao}
                      <div className="codigo">
                        cód. {l.item.codigo}
                        {l.item.ean && ` · EAN ${l.item.ean}`}
                        {(l.validade ?? l.item.lotes[0]?.validade) &&
                          ` · val. ${(l.validade ?? l.item.lotes[0]!.validade!).split('-').reverse().join('/')}`}
                      </div>
                    </td>
                    <td className="num">
                      {qtdNota(l.item.quantidade)} {l.item.unidade}
                      <div className="codigo">{formatarMoeda(l.item.custoTotal)}</div>
                    </td>
                    <td>
                      {l.ignorado ? (
                        <span className="dica">ignorado</span>
                      ) : l.produto ? (
                        <>
                          {l.produto.descricao}
                          <div className="codigo">{l.origem && ORIGENS[l.origem]}</div>
                        </>
                      ) : (
                        <span className="baixo">sem vínculo</span>
                      )}
                    </td>
                    <td className="num">{l.produto ? String(l.fator).replace('.', ',') : ''}</td>
                    <td className={`num ${fracionado ? 'baixo' : ''}`}>
                      {l.produto && `${quantidadeParaTexto(entra, l.produto.unidade)} ${unidadeVenda(l.produto.unidade)}`}
                    </td>
                    <td className="num">
                      {custo !== null && formatarMoeda(custo)}
                      {l.produto?.precoCusto != null && custo !== null && custo !== l.produto.precoCusto && (
                        <div className={`codigo ${custo > l.produto.precoCusto ? 'baixo' : ''}`}>
                          era {formatarMoeda(l.produto.precoCusto)}
                        </div>
                      )}
                    </td>
                    <td className="num">
                      {venda !== null && formatarMoeda(venda)}
                      {l.precoVenda !== null && <div className="codigo">novo</div>}
                    </td>
                    <td className="num">{textoMargem(venda, custo) ?? ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {erro && <p className="erro">{erro}</p>}
        <p className="dica">
          ↑ ↓ escolhe · <kbd>F2</kbd> vincular a um produto · <kbd>F3</kbd> cadastrar novo · <kbd>F6</kbd> fator (un. por
          embalagem) · <kbd>F7</kbd> novo preço de venda · <kbd>F8</kbd> validade · <kbd>Del</kbd> ignorar item
        </p>

        <div className="acoes">
          <span className="dica">{aVincular > 0 ? `${aVincular} itens sem vínculo` : 'Todos os itens resolvidos'}</span>
          <span className="espaco" />
          <button className="secundario" onClick={() => onFechar(null)}>
            <kbd>Esc</kbd> Cancelar
          </button>
          <button className="primario" onClick={() => void confirmar()} disabled={ocupado}>
            <kbd>F10</kbd> Dar entrada
          </button>
        </div>
      </div>

      {modal === 'busca' && <BuscaProduto onEscolher={vincular} onFechar={() => setModal(null)} />}

      {modal === 'criar' && linha && (
        <FormProduto
          produto={null}
          sugestao={{
            ean: linha.item.eanTributavel ?? (linha.item.ean?.length === 14 ? null : linha.item.ean),
            descricao: linha.item.descricao,
            unidade: linha.item.unidade === 'KG' ? 'KG' : 'UN',
            precoCusto: custoUnitario(
              linha.item.custoTotal,
              quantidadeEntrada(linha.item.quantidade, fatorSugerido(linha.item))
            )
          }}
          onFechar={(salvo) => {
            if (salvo) {
              alterar({ produto: salvo, origem: 'manual', fator: fatorSugerido(linha.item), ignorado: false })
            }
            setModal(null)
          }}
          onAbrirExistente={vincular}
        />
      )}

      {modal === 'fator' && linha?.produto && (
        <Prompt
          titulo={`Fator do item ${linha.item.numero}`}
          rotulo={`Quantas ${unidadeVenda(linha.produto.unidade)} de "${linha.produto.descricao}" há em 1 ${linha.item.unidade} da nota?`}
          dica="Ex.: caixa com 12 → 12. O fator fica guardado para as próximas notas deste fornecedor."
          inicial={String(linha.fator).replace('.', ',')}
          confirmar={async (texto) => {
            const fator = Number(texto.replace(',', '.'))
            if (!Number.isFinite(fator) || fator <= 0 || fator > 100_000) return 'Fator inválido'
            alterar({ fator: Math.round(fator * 1000) / 1000 })
            setModal(null)
            return null
          }}
          onFechar={() => setModal(null)}
        />
      )}

      {modal === 'validade' && linha?.produto && (
        <Prompt
          titulo={`Validade · ${linha.produto.descricao}`}
          rotulo="Data de validade (dd/mm/aaaa)"
          dica="Em branco usa a da nota (se houver). Fica registrada como lote para os alertas de vencimento."
          inicial={linha.validade ? linha.validade.split('-').reverse().join('/') : ''}
          confirmar={async (texto) => {
            if (texto.trim() === '') {
              alterar({ validade: null })
              setModal(null)
              return null
            }
            const iso = lerData(texto)
            if (!iso) return 'Data inválida. Use dd/mm/aaaa.'
            alterar({ validade: iso })
            setModal(null)
            return null
          }}
          onFechar={() => setModal(null)}
        />
      )}

      {modal === 'preco' && linha?.produto && (
        <Prompt
          titulo={`Preço de venda · ${linha.produto.descricao}`}
          rotulo={`Atual ${formatarMoeda(linha.produto.precoVenda)}${linha.produto.unidade === 'KG' ? '/kg' : ''}`}
          dica="Em branco mantém o preço atual. O novo preço vale ao dar entrada."
          inicial={linha.precoVenda !== null ? centavosParaTexto(linha.precoVenda) : ''}
          confirmar={async (texto) => {
            if (texto.trim() === '') {
              alterar({ precoVenda: null })
              setModal(null)
              return null
            }
            const v = lerMoeda(texto)
            if (v === null || v <= 0) return 'Preço inválido'
            alterar({ precoVenda: v === linha.produto!.precoVenda ? null : v })
            setModal(null)
            return null
          }}
          onFechar={() => setModal(null)}
        />
      )}
    </div>
  )
}
