import { lerMoeda, lerQuantidade } from '@shared/dinheiro'
import { limparCodigo } from '@shared/ean'
import type {
  ErroImportacao,
  LinhaImportacao,
  Produto,
  ProdutoEntrada,
  ResultadoImportacao,
  Unidade
} from '@shared/produtos'
import { normalizarBusca } from '@shared/texto'
import type { Banco } from '../db/conexao'
import { emTransacao } from '../db/transacao'
import { ErroNegocio } from '../erros'
import {
  atualizarProduto,
  conferirDuplicados,
  criarProduto,
  produtoParaEntrada,
  produtoPorCodigoBalanca,
  produtoPorDescricao,
  produtoPorEan,
  validarProdutoEntrada
} from '../repos/produtos'
import { lerCsv } from './csv'

/** Colunas da planilha (promoção e atacarejo são cadastrados no formulário). */
type Campo = Exclude<
  keyof ProdutoEntrada,
  'precoPromocional' | 'promocaoInicio' | 'promocaoFim' | 'atacadoQuantidade' | 'atacadoPreco'
>

/** Nomes de coluna aceitos (comparados sem acento, maiúscula ou pontuação). */
const ALIASES: Record<Campo, string[]> = {
  ean: ['ean', 'gtin', 'codigo_de_barras', 'codigo_barras', 'cod_barras', 'cod_de_barras'],
  descricao: ['descricao', 'nome', 'produto', 'descricao_do_produto'],
  unidade: ['unidade', 'un', 'und', 'unid'],
  precoVenda: ['preco_venda', 'preco_de_venda', 'preco', 'venda', 'valor', 'valor_venda'],
  precoCusto: ['preco_custo', 'preco_de_custo', 'custo', 'valor_custo'],
  categoria: ['categoria', 'grupo', 'departamento', 'secao'],
  estoqueAtual: ['estoque', 'estoque_atual', 'quantidade', 'qtd', 'saldo'],
  estoqueMinimo: ['estoque_minimo', 'minimo', 'est_minimo'],
  codigoBalanca: ['codigo_balanca', 'cod_balanca', 'plu', 'balanca', 'codigo_interno', 'cod_interno']
}

const UNIDADES: Record<string, Unidade> = {
  un: 'UN', und: 'UN', unid: 'UN', unidade: 'UN', pc: 'UN', pct: 'UN', cx: 'UN',
  kg: 'KG', quilo: 'KG', kilo: 'KG'
}

export const MODELO_CSV =
  '﻿ean;descricao;unidade;preco_venda;preco_custo;categoria;estoque;estoque_minimo;codigo_balanca\r\n' +
  '7891000100103;Leite Condensado 395g;UN;7,49;5,10;Mercearia;24;6;\r\n' +
  ';Banana Prata;KG;6,99;3,50;Hortifruti;0;0;12\r\n'

function chaveColuna(cabecalho: string): string {
  return normalizarBusca(cabecalho).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function mapearColunas(cabecalho: string[]): Partial<Record<Campo, number>> {
  const mapa: Partial<Record<Campo, number>> = {}
  cabecalho.forEach((h, indice) => {
    const chave = chaveColuna(h)
    for (const [campo, aliases] of Object.entries(ALIASES) as [Campo, string[]][]) {
      if (mapa[campo] === undefined && aliases.includes(chave)) mapa[campo] = indice
    }
  })
  return mapa
}

/** Preço da planilha: "7,49", "1.234,56" ou, de planilha em inglês, "7.49". */
function lerPreco(texto: string, campo: string): number {
  const valor = lerMoeda(texto) ?? (/^\d+\.\d{1,2}$/.test(texto) ? Math.round(Number(texto) * 100) : null)
  if (valor === null || valor < 0) throw new ErroNegocio(`${campo} inválido: "${texto}"`)
  return valor
}

function lerLinha(celulas: string[], colunas: Partial<Record<Campo, number>>): Partial<ProdutoEntrada> {
  const valor = (campo: Campo): string | null => {
    const i = colunas[campo]
    const v = i === undefined ? '' : (celulas[i] ?? '').trim()
    return v === '' ? null : v
  }
  const parcial: Partial<ProdutoEntrada> = {}

  const ean = valor('ean')
  if (ean !== null) {
    if (/e\+/i.test(ean)) {
      throw new ErroNegocio('EAN em notação científica: no Excel, formate a coluna como Texto')
    }
    parcial.ean = limparCodigo(ean)
  }

  const descricao = valor('descricao')
  if (descricao !== null) parcial.descricao = descricao

  const unidade = valor('unidade')
  if (unidade !== null) {
    const u = UNIDADES[normalizarBusca(unidade)]
    if (!u) throw new ErroNegocio(`Unidade desconhecida: "${unidade}" (use UN ou KG)`)
    parcial.unidade = u
  }

  const precoVenda = valor('precoVenda')
  if (precoVenda !== null) parcial.precoVenda = lerPreco(precoVenda, 'Preço de venda')
  const precoCusto = valor('precoCusto')
  if (precoCusto !== null) parcial.precoCusto = lerPreco(precoCusto, 'Preço de custo')

  const categoria = valor('categoria')
  if (categoria !== null) parcial.categoria = categoria

  for (const campo of ['estoqueAtual', 'estoqueMinimo'] as const) {
    const texto = valor(campo)
    if (texto === null) continue
    const q = lerQuantidade(texto)
    if (q === null) throw new ErroNegocio(`Quantidade inválida: "${texto}"`)
    parcial[campo] = q
  }

  const codigoBalanca = valor('codigoBalanca')
  if (codigoBalanca !== null) {
    if (!/^\d{1,6}$/.test(codigoBalanca)) throw new ErroNegocio(`Código da balança inválido: "${codigoBalanca}"`)
    parcial.codigoBalanca = Number(codigoBalanca)
  }
  return parcial
}

function acharExistente(db: Banco, p: Partial<ProdutoEntrada>): Produto | null {
  if (p.ean) return produtoPorEan(db, p.ean)
  if (p.codigoBalanca !== undefined && p.codigoBalanca !== null) {
    return produtoPorCodigoBalanca(db, p.codigoBalanca)
  }
  // Sem código nenhum, a descrição é a única forma de não duplicar o produto ao reimportar.
  return p.descricao ? produtoPorDescricao(db, p.descricao) : null
}

const NOVO: Omit<ProdutoEntrada, 'descricao' | 'precoVenda'> = {
  ean: null,
  codigoBalanca: null,
  unidade: 'UN',
  precoCusto: null,
  categoria: null,
  estoqueAtual: 0,
  estoqueMinimo: 0
}

export interface AnaliseCsv {
  totalLinhas: number
  linhas: LinhaImportacao[]
  erros: ErroImportacao[]
}

/**
 * Lê o CSV e decide, linha a linha, se cria ou atualiza. Não grava nada.
 * Produto existente: só as colunas preenchidas mudam, e o estoque não é sobrescrito
 * (estoque de produto já cadastrado só muda por entrada de mercadoria ou ajuste).
 */
export function analisarCsvProdutos(db: Banco, texto: string): AnaliseCsv {
  const [cabecalho, ...corpo] = lerCsv(texto)
  if (!cabecalho) return { totalLinhas: 0, linhas: [], erros: [{ linha: 1, mensagem: 'Arquivo vazio' }] }

  const colunas = mapearColunas(cabecalho)
  const faltando = (['descricao', 'precoVenda'] as const).filter((c) => colunas[c] === undefined)
  if (faltando.length > 0) {
    const nomes = faltando.map((c) => ALIASES[c][0]).join(', ')
    return { totalLinhas: corpo.length, linhas: [], erros: [{ linha: 1, mensagem: `Faltam as colunas: ${nomes}` }] }
  }

  const linhas: LinhaImportacao[] = []
  const erros: ErroImportacao[] = []
  const vistos = new Map<string, number>()
  let totalLinhas = 0

  corpo.forEach((celulas, i) => {
    const linha = i + 2
    if (celulas.every((c) => c.trim() === '')) return
    totalLinhas++
    try {
      const parcial = lerLinha(celulas, colunas)
      const existente = acharExistente(db, parcial)
      const definidos = Object.fromEntries(
        Object.entries(parcial).filter(([, v]) => v !== undefined)
      ) as Partial<ProdutoEntrada>
      const bruto = existente
        ? { ...produtoParaEntrada(existente), ...definidos, estoqueAtual: existente.estoqueAtual }
        : { ...NOVO, ...definidos }
      const entrada = validarProdutoEntrada(bruto)
      conferirDuplicados(db, entrada, existente?.id ?? null)

      const chaves = [
        entrada.ean && `ean:${entrada.ean}`,
        entrada.codigoBalanca !== null && `balanca:${entrada.codigoBalanca}`,
        !entrada.ean && entrada.codigoBalanca === null && `descricao:${normalizarBusca(entrada.descricao)}`
      ].filter((c): c is string => typeof c === 'string')
      for (const chave of chaves) {
        const anterior = vistos.get(chave)
        if (anterior !== undefined) throw new ErroNegocio(`Produto repetido (já aparece na linha ${anterior})`)
      }
      chaves.forEach((c) => vistos.set(c, linha))

      linhas.push({
        linha,
        acao: existente ? 'atualizar' : 'criar',
        produtoId: existente?.id ?? null,
        entrada
      })
    } catch (erro) {
      if (!(erro instanceof ErroNegocio)) throw erro
      erros.push({ linha, mensagem: erro.message })
    }
  })

  return { totalLinhas, linhas, erros }
}

/** Grava as linhas válidas, tudo ou nada. Reanalisa para não usar uma prévia desatualizada. */
export function importarCsvProdutos(db: Banco, texto: string): ResultadoImportacao {
  return emTransacao(db, () => {
    const { linhas } = analisarCsvProdutos(db, texto)
    let criados = 0
    let atualizados = 0
    for (const l of linhas) {
      if (l.acao === 'criar') {
        criarProduto(db, l.entrada)
        criados++
      } else {
        atualizarProduto(db, l.produtoId!, l.entrada)
        atualizados++
      }
    }
    return { criados, atualizados }
  })
}
