import { useEffect, useRef, useState } from 'react'
import { centavosParaTexto, lerMoeda, lerQuantidade, quantidadeParaTexto } from '@shared/dinheiro'
import { NOMES_BASES_OPEN_FACTS, type Categoria, type Produto, type ProdutoEntrada, type Unidade } from '@shared/produtos'
import { mensagemErro, textoMargem, useTeclas } from '../util'

interface Props {
  produto: Produto | null
  /** Dados para pré-preencher um produto novo (ex.: item de uma NF-e). */
  sugestao?: Partial<ProdutoEntrada>
  onFechar: (salvo?: Produto) => void
  onAbrirExistente: (produto: Produto) => void
}

interface Campos {
  ean: string
  descricao: string
  unidade: Unidade
  precoVenda: string
  precoCusto: string
  categoria: string
  estoqueAtual: string
  estoqueMinimo: string
  codigoBalanca: string
  precoPromocional: string
  promocaoInicio: string
  promocaoFim: string
  atacadoQuantidade: string
  atacadoPreco: string
}

function camposDe(p: Produto | null): Campos {
  return {
    ean: p?.ean ?? '',
    descricao: p?.descricao ?? '',
    unidade: p?.unidade ?? 'UN',
    precoVenda: p ? centavosParaTexto(p.precoVenda) : '',
    precoCusto: p?.precoCusto != null ? centavosParaTexto(p.precoCusto) : '',
    categoria: p?.categoria ?? '',
    estoqueAtual: p ? quantidadeParaTexto(p.estoqueAtual, p.unidade) : '0',
    estoqueMinimo: p ? quantidadeParaTexto(p.estoqueMinimo, p.unidade) : '0',
    codigoBalanca: p?.codigoBalanca != null ? String(p.codigoBalanca) : '',
    precoPromocional: p?.precoPromocional != null ? centavosParaTexto(p.precoPromocional) : '',
    promocaoInicio: p?.promocaoInicio ?? '',
    promocaoFim: p?.promocaoFim ?? '',
    atacadoQuantidade: p?.atacadoQuantidade != null ? quantidadeParaTexto(p.atacadoQuantidade, p.unidade) : '',
    atacadoPreco: p?.atacadoPreco != null ? centavosParaTexto(p.atacadoPreco) : ''
  }
}

const MOTIVOS = {
  'nao-encontrado': 'Não encontrado nas bases Open Facts (alimentos, higiene, pet, limpeza). Preencha os dados.',
  'sem-internet': 'Sem internet agora. Preencha os dados manualmente.',
  'ean-invalido': 'EAN inválido. Confira os dígitos.'
} as const

/** Converte os campos digitados em entrada; lança Error com a mensagem para o operador. */
function montarEntrada(c: Campos): ProdutoEntrada {
  const precoVenda = lerMoeda(c.precoVenda)
  if (precoVenda === null) throw new Error('Preço de venda inválido')
  let precoCusto: number | null = null
  if (c.precoCusto.trim() !== '') {
    precoCusto = lerMoeda(c.precoCusto)
    if (precoCusto === null) throw new Error('Preço de custo inválido')
  }
  const estoqueAtual = c.estoqueAtual.trim() === '' ? 0 : lerQuantidade(c.estoqueAtual)
  if (estoqueAtual === null) throw new Error('Estoque atual inválido')
  const estoqueMinimo = c.estoqueMinimo.trim() === '' ? 0 : lerQuantidade(c.estoqueMinimo)
  if (estoqueMinimo === null) throw new Error('Estoque mínimo inválido')
  const codigo = c.codigoBalanca.trim()
  if (codigo !== '' && !/^\d{1,6}$/.test(codigo)) throw new Error('Código da balança: até 6 dígitos')

  let precoPromocional: number | null = null
  if (c.precoPromocional.trim()) {
    precoPromocional = lerMoeda(c.precoPromocional)
    if (precoPromocional === null) throw new Error('Preço promocional inválido')
  }
  let atacadoQuantidade: number | null = null
  let atacadoPreco: number | null = null
  if (c.atacadoQuantidade.trim() || c.atacadoPreco.trim()) {
    atacadoQuantidade = lerQuantidade(c.atacadoQuantidade)
    atacadoPreco = lerMoeda(c.atacadoPreco)
    if (atacadoQuantidade === null || atacadoPreco === null) throw new Error('Atacarejo: informe a quantidade e o preço')
  }

  return {
    precoPromocional,
    promocaoInicio: precoPromocional !== null ? c.promocaoInicio || null : null,
    promocaoFim: precoPromocional !== null ? c.promocaoFim || null : null,
    atacadoQuantidade,
    atacadoPreco,
    ean: c.ean.trim() || null,
    codigoBalanca: codigo === '' ? null : Number(codigo),
    descricao: c.descricao,
    unidade: c.unidade,
    precoVenda,
    precoCusto,
    categoria: c.categoria.trim() || null,
    estoqueAtual,
    estoqueMinimo
  }
}

/** Enter num campo pula para o próximo (como nos PDVs de balcão); salvar é F10. */
function avancarComEnter(e: React.KeyboardEvent<HTMLFormElement>): void {
  const alvo = e.target as HTMLElement
  if (e.key !== 'Enter' || e.defaultPrevented || !(alvo instanceof HTMLInputElement || alvo instanceof HTMLSelectElement)) {
    return
  }
  e.preventDefault()
  const campos = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input, select'))
  campos[campos.indexOf(alvo) + 1]?.focus()
}

export function FormProduto({ produto, sugestao, onFechar, onAbrirExistente }: Props): React.JSX.Element {
  const [campos, setCampos] = useState<Campos>(() => {
    const base = camposDe(produto)
    if (produto || !sugestao) return base
    return {
      ...base,
      ean: sugestao.ean ?? base.ean,
      descricao: sugestao.descricao ?? base.descricao,
      unidade: sugestao.unidade ?? base.unidade,
      precoCusto: sugestao.precoCusto != null ? centavosParaTexto(sugestao.precoCusto) : base.precoCusto
    }
  })
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [existente, setExistente] = useState<Produto | null>(null)
  const [consultando, setConsultando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const refEan = useRef<HTMLInputElement>(null)
  const refDescricao = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.pdv.produtos.categorias().then(setCategorias).catch(() => setCategorias([]))
    ;(produto || sugestao?.descricao ? refDescricao : refEan).current?.focus()
    // Só na montagem: o formulário é recriado (key) quando muda o produto.
  }, [])

  const definir = <K extends keyof Campos>(campo: K, valor: Campos[K]): void =>
    setCampos((c) => ({ ...c, [campo]: valor }))

  async function consultar(): Promise<void> {
    const ean = campos.ean.trim()
    if (!ean || consultando) return
    setConsultando(true)
    setErro(null)
    setInfo(null)
    setExistente(null)
    try {
      const r = await window.pdv.produtos.consultarEan(ean)
      if (r.origem === 'local') {
        if (r.produto.id !== produto?.id) {
          setExistente(r.produto)
          setInfo(`Este EAN já é de "${r.produto.descricao}".`)
        }
      } else if (r.origem === 'openfoodfacts') {
        setCampos((c) => ({
          ...c,
          ean: r.sugestao.ean,
          descricao: c.descricao || r.sugestao.descricao
        }))
        setInfo(`Dados do ${NOMES_BASES_OPEN_FACTS[r.sugestao.base]}. Confira a descrição e informe o preço.`)
      } else {
        setInfo(MOTIVOS[r.motivo])
      }
      refDescricao.current?.focus()
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setConsultando(false)
    }
  }

  async function salvar(): Promise<void> {
    if (salvando) return
    setErro(null)
    let entrada: ProdutoEntrada
    try {
      entrada = montarEntrada(campos)
    } catch (e) {
      setErro(mensagemErro(e))
      return
    }
    setSalvando(true)
    try {
      const salvo = produto
        ? await window.pdv.produtos.atualizar(produto.id, entrada)
        : await window.pdv.produtos.criar(entrada)
      onFechar(salvo)
    } catch (e) {
      setErro(mensagemErro(e))
      setSalvando(false)
    }
  }

  async function alternarAtivo(): Promise<void> {
    if (!produto) return
    try {
      await window.pdv.produtos.definirAtivo(produto.id, !produto.ativo)
      onFechar({ ...produto, ativo: !produto.ativo })
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }

  useTeclas({
    Escape: () => onFechar(),
    F10: () => void salvar(),
    'Ctrl+s': () => void salvar()
  })

  const venda = lerMoeda(campos.precoVenda)
  const custo = campos.precoCusto.trim() === '' ? null : lerMoeda(campos.precoCusto)
  const margem = textoMargem(venda, custo)

  return (
    <div className="fundo-modal">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault()
          void salvar()
        }}
        onKeyDown={avancarComEnter}
      >
        <h2>{produto ? 'Editar produto' : 'Novo produto'}</h2>

        <div className="grade">
          <label className="largo">
            EAN (código de barras)
            <div className="linha-campo">
              <input
                ref={refEan}
                value={campos.ean}
                inputMode="numeric"
                placeholder="Bipe ou digite e tecle Enter"
                onChange={(e) => definir('ean', e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void consultar()
                  }
                }}
              />
              <button type="button" onClick={() => void consultar()} disabled={consultando}>
                {consultando ? 'Consultando…' : 'Consultar'}
              </button>
            </div>
          </label>

          {info && (
            <p className="aviso largo">
              {info}
              {existente && (
                <button type="button" className="link" onClick={() => onAbrirExistente(existente)}>
                  Abrir esse cadastro
                </button>
              )}
            </p>
          )}

          <label className="largo">
            Descrição
            <input
              ref={refDescricao}
              value={campos.descricao}
              maxLength={120}
              onChange={(e) => definir('descricao', e.target.value)}
            />
          </label>

          <label>
            Unidade
            <select value={campos.unidade} onChange={(e) => definir('unidade', e.target.value as Unidade)}>
              <option value="UN">UN (unidade)</option>
              <option value="KG">KG (pesado)</option>
            </select>
          </label>

          <label>
            Código na balança
            <input
              value={campos.codigoBalanca}
              inputMode="numeric"
              placeholder={campos.unidade === 'KG' ? 'PLU programado' : 'opcional'}
              onChange={(e) => definir('codigoBalanca', e.target.value)}
            />
          </label>

          <label>
            Preço de venda (R${campos.unidade === 'KG' ? '/kg' : ''})
            <input
              value={campos.precoVenda}
              inputMode="decimal"
              placeholder="0,00"
              onChange={(e) => definir('precoVenda', e.target.value)}
            />
          </label>

          <label>
            Preço de custo (R$)
            <input
              value={campos.precoCusto}
              inputMode="decimal"
              placeholder="opcional"
              onChange={(e) => definir('precoCusto', e.target.value)}
            />
            {margem && <small>Margem: {margem}</small>}
          </label>

          <label className="largo">
            Categoria
            <input
              value={campos.categoria}
              list="categorias"
              maxLength={60}
              onChange={(e) => definir('categoria', e.target.value)}
            />
            <datalist id="categorias">
              {categorias.map((c) => (
                <option key={c.id} value={c.nome} />
              ))}
            </datalist>
          </label>

          <label>
            Estoque atual ({campos.unidade === 'KG' ? 'kg' : 'un'})
            <input
              value={campos.estoqueAtual}
              inputMode="decimal"
              onChange={(e) => definir('estoqueAtual', e.target.value)}
            />
          </label>

          <label>
            Estoque mínimo ({campos.unidade === 'KG' ? 'kg' : 'un'})
            <input
              value={campos.estoqueMinimo}
              inputMode="decimal"
              onChange={(e) => definir('estoqueMinimo', e.target.value)}
            />
          </label>
        </div>

        <details className="promocoes" open={!!(campos.precoPromocional || campos.atacadoQuantidade)}>
          <summary>Promoção e atacarejo</summary>
          <div className="grade grade-3">
            <label>
              Preço promocional (R$)
              <input
                value={campos.precoPromocional}
                inputMode="decimal"
                placeholder="sem promoção"
                onChange={(e) => definir('precoPromocional', e.target.value)}
              />
            </label>
            <label>
              De
              <input type="date" value={campos.promocaoInicio} onChange={(e) => definir('promocaoInicio', e.target.value)} />
            </label>
            <label>
              Até
              <input type="date" value={campos.promocaoFim} onChange={(e) => definir('promocaoFim', e.target.value)} />
            </label>
            <label>
              Atacarejo: a partir de ({campos.unidade === 'KG' ? 'kg' : 'un'})
              <input
                value={campos.atacadoQuantidade}
                inputMode="decimal"
                placeholder="ex.: 3"
                onChange={(e) => definir('atacadoQuantidade', e.target.value)}
              />
            </label>
            <label>
              preço de atacado (R$)
              <input
                value={campos.atacadoPreco}
                inputMode="decimal"
                placeholder="0,00"
                onChange={(e) => definir('atacadoPreco', e.target.value)}
              />
            </label>
            <p className="dica">
              O atacado vale pela quantidade total do produto na venda (bipar 3 vezes conta como 3). Mudou preço,
              promoção ou atacado: o produto entra na próxima leva de etiquetas de gôndola.
            </p>
          </div>
        </details>

        {erro && <p className="erro">{erro}</p>}

        <div className="acoes">
          {produto && (
            <button type="button" className="secundario" onClick={() => void alternarAtivo()}>
              {produto.ativo ? 'Inativar' : 'Reativar'}
            </button>
          )}
          <span className="espaco" />
          <button type="button" className="secundario" onClick={() => onFechar()}>
            <kbd>Esc</kbd> Cancelar
          </button>
          <button type="submit" className="primario" disabled={salvando}>
            <kbd>F10</kbd> Salvar
          </button>
        </div>
      </form>
    </div>
  )
}
