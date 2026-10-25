import { eanValido, limparCodigo } from '@shared/ean'
import type { Categoria, Produto, ProdutoEntrada, Unidade } from '@shared/produtos'
import { limparEspacos, normalizarBusca } from '@shared/texto'
import type { Banco } from '../db/conexao'
import { emTransacao } from '../db/transacao'
import { ErroNegocio } from '../erros'
import { movimentarEstoque } from './estoque'

const PRECO_MAXIMO = 9_999_999 // R$ 99.999,99
const ESTOQUE_MAXIMO = 1_000_000_000_000
const LIMITE_BUSCA = 200

interface LinhaProduto {
  id: number
  ean: string | null
  codigo_balanca: number | null
  descricao: string
  unidade: Unidade
  preco_venda: number
  preco_custo: number | null
  categoria_id: number | null
  categoria_nome: string | null
  estoque_atual: number
  estoque_minimo: number
  ativo: number
  criado_em: string
  atualizado_em: string
  preco_alterado_em: string
  preco_promocional: number | null
  promocao_inicio: string | null
  promocao_fim: string | null
  atacado_quantidade: number | null
  atacado_preco: number | null
}

const SELECT_PRODUTO = `
  SELECT p.*, c.nome AS categoria_nome
  FROM produtos p
  LEFT JOIN categorias c ON c.id = p.categoria_id`

function paraProduto(l: LinhaProduto): Produto {
  return {
    id: l.id,
    ean: l.ean,
    codigoBalanca: l.codigo_balanca,
    descricao: l.descricao,
    unidade: l.unidade,
    precoVenda: l.preco_venda,
    precoCusto: l.preco_custo,
    categoriaId: l.categoria_id,
    categoria: l.categoria_nome,
    estoqueAtual: l.estoque_atual,
    estoqueMinimo: l.estoque_minimo,
    ativo: l.ativo === 1,
    criadoEm: l.criado_em,
    atualizadoEm: l.atualizado_em,
    precoAlteradoEm: l.preco_alterado_em,
    precoPromocional: l.preco_promocional,
    promocaoInicio: l.promocao_inicio,
    promocaoFim: l.promocao_fim,
    atacadoQuantidade: l.atacado_quantidade,
    atacadoPreco: l.atacado_preco
  }
}

const dataValida = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00`))

/** Promoção (preço + início + fim) e atacarejo (quantidade + preço): tudo ou nada em cada um. */
function validarPromocoes(d: Record<string, unknown>, precoVenda: number, unidade: Unidade) {
  const vazio = (v: unknown): boolean => v === null || v === undefined || v === ''
  let precoPromocional: number | null = null
  let promocaoInicio: string | null = null
  let promocaoFim: string | null = null
  if (!vazio(d['precoPromocional'])) {
    precoPromocional = inteiro(d['precoPromocional'], 'Preço promocional', 1, PRECO_MAXIMO)
    if (precoPromocional >= precoVenda) throw new ErroNegocio('O preço promocional precisa ser menor que o de venda')
    if (!dataValida(d['promocaoInicio']) || !dataValida(d['promocaoFim'])) {
      throw new ErroNegocio('Informe o início e o fim da promoção')
    }
    promocaoInicio = d['promocaoInicio']
    promocaoFim = d['promocaoFim']
    if (promocaoFim < promocaoInicio) throw new ErroNegocio('O fim da promoção é antes do início')
  }

  let atacadoQuantidade: number | null = null
  let atacadoPreco: number | null = null
  if (!vazio(d['atacadoQuantidade']) || !vazio(d['atacadoPreco'])) {
    atacadoQuantidade = inteiro(d['atacadoQuantidade'], 'Quantidade do atacado', 1, ESTOQUE_MAXIMO)
    atacadoPreco = inteiro(d['atacadoPreco'], 'Preço de atacado', 1, PRECO_MAXIMO)
    if (unidade === 'UN' && (atacadoQuantidade % 1000 !== 0 || atacadoQuantidade < 2000)) {
      throw new ErroNegocio('Atacado: a partir de 2 unidades (quantidade inteira)')
    }
    if (atacadoPreco >= precoVenda) throw new ErroNegocio('O preço de atacado precisa ser menor que o de venda')
  }
  return { precoPromocional, promocaoInicio, promocaoFim, atacadoQuantidade, atacadoPreco }
}

function inteiro(valor: unknown, campo: string, min: number, max: number): number {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < min || valor > max) {
    throw new ErroNegocio(`${campo} inválido`)
  }
  return valor
}

/** Valida e normaliza o que veio do renderer ou da importação. */
export function validarProdutoEntrada(dado: unknown): ProdutoEntrada {
  if (typeof dado !== 'object' || dado === null) throw new ErroNegocio('Produto inválido')
  const d = dado as Record<string, unknown>

  const descricao = typeof d['descricao'] === 'string' ? limparEspacos(d['descricao']) : ''
  if (descricao.length === 0) throw new ErroNegocio('Informe a descrição')
  if (descricao.length > 120) throw new ErroNegocio('Descrição com mais de 120 caracteres')

  let ean: string | null = null
  if (d['ean'] !== null && d['ean'] !== undefined && d['ean'] !== '') {
    if (typeof d['ean'] !== 'string') throw new ErroNegocio('EAN inválido')
    ean = limparCodigo(d['ean'])
    if (!eanValido(ean)) throw new ErroNegocio(`EAN ${ean} inválido (confira os dígitos)`)
  }

  const unidade = d['unidade']
  if (unidade !== 'UN' && unidade !== 'KG') throw new ErroNegocio('Unidade deve ser UN ou KG')

  const codigoBalanca =
    d['codigoBalanca'] === null || d['codigoBalanca'] === undefined
      ? null
      : inteiro(d['codigoBalanca'], 'Código da balança', 1, 999_999)

  const precoVenda = inteiro(d['precoVenda'], 'Preço de venda', 0, PRECO_MAXIMO)
  if (precoVenda === 0) throw new ErroNegocio('Informe o preço de venda')
  const precoCusto =
    d['precoCusto'] === null || d['precoCusto'] === undefined
      ? null
      : inteiro(d['precoCusto'], 'Preço de custo', 0, PRECO_MAXIMO)

  let categoria: string | null = null
  if (typeof d['categoria'] === 'string' && d['categoria'].trim() !== '') {
    categoria = limparEspacos(d['categoria'])
    if (categoria.length > 60) throw new ErroNegocio('Categoria com mais de 60 caracteres')
  }

  return {
    ean,
    codigoBalanca,
    descricao,
    unidade,
    precoVenda,
    precoCusto,
    categoria,
    estoqueAtual: inteiro(d['estoqueAtual'] ?? 0, 'Estoque atual', -ESTOQUE_MAXIMO, ESTOQUE_MAXIMO),
    estoqueMinimo: inteiro(d['estoqueMinimo'] ?? 0, 'Estoque mínimo', 0, ESTOQUE_MAXIMO),
    ...validarPromocoes(d, precoVenda, unidade)
  }
}

export function obterProduto(db: Banco, id: number): Produto | null {
  const l = db.prepare(`${SELECT_PRODUTO} WHERE p.id = ?`).get(id) as LinhaProduto | undefined
  return l ? paraProduto(l) : null
}

export function produtoPorEan(db: Banco, ean: string): Produto | null {
  const l = db.prepare(`${SELECT_PRODUTO} WHERE p.ean = ?`).get(ean) as LinhaProduto | undefined
  return l ? paraProduto(l) : null
}

export function produtoPorCodigoBalanca(db: Banco, codigo: number): Produto | null {
  const l = db.prepare(`${SELECT_PRODUTO} WHERE p.codigo_balanca = ?`).get(codigo) as
    | LinhaProduto
    | undefined
  return l ? paraProduto(l) : null
}

/** Produto com a mesma descrição (sem acento/maiúscula), usado para casar linhas da importação. */
export function produtoPorDescricao(db: Banco, descricao: string): Produto | null {
  const l = db
    .prepare(`${SELECT_PRODUTO} WHERE p.descricao_busca = ? ORDER BY p.id LIMIT 1`)
    .get(normalizarBusca(descricao)) as LinhaProduto | undefined
  return l ? paraProduto(l) : null
}

function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * Busca por descrição (todas as palavras, em qualquer ordem, sem acento) ou por
 * EAN/código da balança exatos, que aparecem primeiro.
 */
export function buscarProdutos(
  db: Banco,
  termo: string,
  { incluirInativos = false }: { incluirInativos?: boolean } = {}
): Produto[] {
  const condicoes: string[] = []
  const params: (string | number)[] = []
  let ordemCodigo = ''
  const ordemParams: (string | number)[] = []

  if (!incluirInativos) condicoes.push('p.ativo = 1')

  const palavras = normalizarBusca(termo).split(' ').filter(Boolean)
  if (palavras.length > 0) {
    const porTexto = palavras.map(() => `p.descricao_busca LIKE ? ESCAPE '\\'`).join(' AND ')
    const paramsTexto = palavras.map((p) => `%${escaparLike(p)}%`)
    const codigo = limparCodigo(termo)

    if (/^\d+$/.test(codigo)) {
      const numero = Number(codigo)
      condicoes.push(`(p.ean = ? OR p.codigo_balanca = ? OR (${porTexto}))`)
      params.push(codigo, numero, ...paramsTexto)
      ordemCodigo = 'CASE WHEN p.ean = ? OR p.codigo_balanca = ? THEN 0 ELSE 1 END, '
      ordemParams.push(codigo, numero)
    } else {
      condicoes.push(`(${porTexto})`)
      params.push(...paramsTexto)
    }
  }

  const onde = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : ''
  const linhas = db
    .prepare(`${SELECT_PRODUTO} ${onde} ORDER BY ${ordemCodigo}p.descricao_busca LIMIT ${LIMITE_BUSCA}`)
    .all(...params, ...ordemParams) as unknown as LinhaProduto[]
  return linhas.map(paraProduto)
}

/** Produtos ativos que chegaram no estoque mínimo, os mais críticos primeiro. */
export function produtosNoMinimo(db: Banco): Produto[] {
  const linhas = db
    .prepare(
      `${SELECT_PRODUTO}
       WHERE p.ativo = 1 AND p.estoque_minimo > 0 AND p.estoque_atual <= p.estoque_minimo
       ORDER BY CAST(p.estoque_atual AS REAL) / p.estoque_minimo, p.descricao_busca`
    )
    .all() as unknown as LinhaProduto[]
  return linhas.map(paraProduto)
}

export function contarNoMinimo(db: Banco): number {
  const l = db
    .prepare(
      `SELECT count(*) AS n FROM produtos
       WHERE ativo = 1 AND estoque_minimo > 0 AND estoque_atual <= estoque_minimo`
    )
    .get() as { n: number }
  return l.n
}

export function listarCategorias(db: Banco): Categoria[] {
  return db.prepare('SELECT id, nome FROM categorias ORDER BY nome').all() as unknown as Categoria[]
}

/** Devolve o id da categoria, criando-a se ainda não existe (comparação sem maiúsculas). */
export function garantirCategoria(db: Banco, nome: string): number {
  db.prepare('INSERT INTO categorias (nome) VALUES (?) ON CONFLICT (nome) DO NOTHING').run(nome)
  const l = db.prepare('SELECT id FROM categorias WHERE nome = ?').get(nome) as { id: number }
  return l.id
}

export function conferirDuplicados(db: Banco, entrada: ProdutoEntrada, idAtual: number | null): void {
  if (entrada.ean) {
    const outro = produtoPorEan(db, entrada.ean)
    if (outro && outro.id !== idAtual) {
      throw new ErroNegocio(`O EAN ${entrada.ean} já está cadastrado em "${outro.descricao}"`)
    }
  }
  if (entrada.codigoBalanca !== null) {
    const outro = produtoPorCodigoBalanca(db, entrada.codigoBalanca)
    if (outro && outro.id !== idAtual) {
      throw new ErroNegocio(`O código de balança ${entrada.codigoBalanca} já é de "${outro.descricao}"`)
    }
  }
}

function parametros(db: Banco, e: ProdutoEntrada) {
  return {
    ean: e.ean,
    codigo_balanca: e.codigoBalanca,
    descricao: e.descricao,
    descricao_busca: normalizarBusca(e.descricao),
    unidade: e.unidade,
    preco_venda: e.precoVenda,
    preco_custo: e.precoCusto,
    categoria_id: e.categoria ? garantirCategoria(db, e.categoria) : null,
    estoque_minimo: e.estoqueMinimo,
    preco_promocional: e.precoPromocional ?? null,
    promocao_inicio: e.promocaoInicio ?? null,
    promocao_fim: e.promocaoFim ?? null,
    atacado_quantidade: e.atacadoQuantidade ?? null,
    atacado_preco: e.atacadoPreco ?? null
  }
}

/** Mudou o que vai na etiqueta de gôndola? (preço, promoção ou atacarejo) */
function mudouPreco(atual: Produto, e: ProdutoEntrada): boolean {
  return (
    atual.precoVenda !== e.precoVenda ||
    atual.precoPromocional !== (e.precoPromocional ?? null) ||
    atual.promocaoInicio !== (e.promocaoInicio ?? null) ||
    atual.promocaoFim !== (e.promocaoFim ?? null) ||
    atual.atacadoQuantidade !== (e.atacadoQuantidade ?? null) ||
    atual.atacadoPreco !== (e.atacadoPreco ?? null)
  )
}

export function criarProduto(db: Banco, dado: unknown): Produto {
  const entrada = validarProdutoEntrada(dado)
  return emTransacao(db, () => {
    conferirDuplicados(db, entrada, null)
    const r = db
      .prepare(
        `INSERT INTO produtos (ean, codigo_balanca, descricao, descricao_busca, unidade, preco_venda,
           preco_custo, categoria_id, estoque_minimo, preco_promocional, promocao_inicio, promocao_fim,
           atacado_quantidade, atacado_preco)
         VALUES (:ean, :codigo_balanca, :descricao, :descricao_busca, :unidade, :preco_venda,
           :preco_custo, :categoria_id, :estoque_minimo, :preco_promocional, :promocao_inicio, :promocao_fim,
           :atacado_quantidade, :atacado_preco)`
      )
      .run(parametros(db, entrada))
    const id = Number(r.lastInsertRowid)
    movimentarEstoque(db, id, entrada.estoqueAtual, 'inicial')
    return obterProduto(db, id)!
  })
}

export function atualizarProduto(db: Banco, id: number, dado: unknown): Produto {
  const entrada = validarProdutoEntrada(dado)
  return emTransacao(db, () => {
    const atual = obterProduto(db, id)
    if (!atual) throw new ErroNegocio('Produto não encontrado')
    conferirDuplicados(db, entrada, id)
    // Mudar o estoque no cadastro vira um movimento de ajuste (fica no histórico).
    movimentarEstoque(db, id, entrada.estoqueAtual - atual.estoqueAtual, 'ajuste')
    db.prepare(
      `UPDATE produtos SET
         ean = :ean,
         codigo_balanca = :codigo_balanca,
         descricao = :descricao,
         descricao_busca = :descricao_busca,
         unidade = :unidade,
         preco_alterado_em = CASE WHEN :mudou_preco = 1
           THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE preco_alterado_em END,
         preco_venda = :preco_venda,
         preco_custo = :preco_custo,
         categoria_id = :categoria_id,
         estoque_minimo = :estoque_minimo,
         preco_promocional = :preco_promocional,
         promocao_inicio = :promocao_inicio,
         promocao_fim = :promocao_fim,
         atacado_quantidade = :atacado_quantidade,
         atacado_preco = :atacado_preco,
         atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = :id`
    ).run({ ...parametros(db, entrada), id, mudou_preco: mudouPreco(atual, entrada) ? 1 : 0 })
    return obterProduto(db, id)!
  })
}

/** Produto nunca é apagado (vendas antigas apontam para ele): só sai das buscas. */
export function definirAtivo(db: Banco, id: number, ativo: boolean): void {
  const r = db
    .prepare(
      `UPDATE produtos SET ativo = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
    )
    .run(ativo ? 1 : 0, id)
  if (r.changes === 0) throw new ErroNegocio('Produto não encontrado')
}

/** Converte um produto salvo de volta em entrada (base para atualizações parciais). */
export function produtoParaEntrada(p: Produto): ProdutoEntrada {
  return {
    ean: p.ean,
    codigoBalanca: p.codigoBalanca,
    descricao: p.descricao,
    unidade: p.unidade,
    precoVenda: p.precoVenda,
    precoCusto: p.precoCusto,
    categoria: p.categoria,
    estoqueAtual: p.estoqueAtual,
    estoqueMinimo: p.estoqueMinimo,
    precoPromocional: p.precoPromocional,
    promocaoInicio: p.promocaoInicio,
    promocaoFim: p.promocaoFim,
    atacadoQuantidade: p.atacadoQuantidade,
    atacadoPreco: p.atacadoPreco
  }
}
