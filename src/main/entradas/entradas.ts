import {
  custoUnitario,
  quantidadeEntrada,
  type DecisaoItem,
  type ItemNota,
  type ItemPreviaEntrada,
  type NotaFiscal,
  type ResumoEntrada
} from '@shared/estoque'
import type { Produto } from '@shared/produtos'
import type { Banco } from '../db/conexao'
import { emTransacao } from '../db/transacao'
import { ErroNegocio } from '../erros'
import { registrarLote, validarData } from '../estoque/validade'
import { movimentarEstoque } from '../repos/estoque'
import { obterProduto, produtoPorEan } from '../repos/produtos'

const AGORA = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
const FATOR_MAXIMO = 100_000
const PRECO_MAXIMO = 9_999_999

function idFornecedor(db: Banco, cnpj: string): number | null {
  const l = db.prepare('SELECT id FROM fornecedores WHERE cnpj = ?').get(cnpj) as { id: number } | undefined
  return l?.id ?? null
}

function arredondarFator(fator: number): number {
  return Math.round(fator * 1000) / 1000
}

/**
 * Para cada item da nota, sugere o produto: primeiro o vínculo aprendido em entradas
 * anteriores (código do fornecedor), depois o EAN da embalagem, depois o EAN da unidade
 * tributável. Quando casa pelo EAN da unidade e a nota vem em caixa, o fator sai de qTrib/qCom.
 */
export function sugerirVinculos(db: Banco, nota: NotaFiscal): { fornecedorCadastrado: boolean; itens: ItemPreviaEntrada[] } {
  const fornecedorId = idFornecedor(db, nota.emitente.cnpj)
  const vinculo = db.prepare('SELECT produto_id, fator FROM produto_fornecedor WHERE fornecedor_id = ? AND codigo = ?')

  const itens = nota.itens.map((item): ItemPreviaEntrada => {
    if (fornecedorId !== null) {
      const v = vinculo.get(fornecedorId, item.codigo) as { produto_id: number; fator: number } | undefined
      const produto = v ? obterProduto(db, v.produto_id) : null
      if (v && produto) return { item, produto, origem: 'vinculo', fator: v.fator }
    }
    const porEan = item.ean ? produtoPorEan(db, item.ean) : null
    if (porEan) return { item, produto: porEan, origem: 'ean', fator: 1 }

    const porTrib = item.eanTributavel ? produtoPorEan(db, item.eanTributavel) : null
    if (porTrib) {
      const fator =
        item.eanTributavel !== item.ean && item.quantidade > 0
          ? arredondarFator(item.quantidadeTributavel / item.quantidade)
          : 1
      return { item, produto: porTrib, origem: 'eanTributavel', fator: fator > 0 ? fator : 1 }
    }
    return { item, produto: null, origem: null, fator: 1 }
  })

  return { fornecedorCadastrado: fornecedorId !== null, itens }
}

interface ItemConfirmado {
  item: ItemNota
  produto: Produto
  fator: number
  quantidade: number
  custo: number
  precoVenda: number | null
  validade: string | null
}

function validarDecisoes(db: Banco, nota: NotaFiscal, dado: unknown): ItemConfirmado[] {
  if (!Array.isArray(dado)) throw new ErroNegocio('Decisões inválidas')
  const decisoes = new Map<number, DecisaoItem>()
  for (const d of dado as DecisaoItem[]) {
    if (typeof d !== 'object' || d === null || typeof d.numero !== 'number') throw new ErroNegocio('Decisão inválida')
    decisoes.set(d.numero, d)
  }

  const confirmados: ItemConfirmado[] = []
  for (const item of nota.itens) {
    const d = decisoes.get(item.numero)
    if (!d) throw new ErroNegocio(`Item ${item.numero} (${item.descricao}): escolha o produto ou ignore`)
    if (d.acao === 'ignorar') continue
    if (d.acao !== 'vincular') throw new ErroNegocio('Decisão inválida')

    const produto = typeof d.produtoId === 'number' ? obterProduto(db, d.produtoId) : null
    if (!produto) throw new ErroNegocio(`Item ${item.numero}: produto não encontrado`)
    if (typeof d.fator !== 'number' || !Number.isFinite(d.fator) || d.fator <= 0 || d.fator > FATOR_MAXIMO) {
      throw new ErroNegocio(`Item ${item.numero}: fator inválido`)
    }
    const fator = arredondarFator(d.fator)
    const quantidade = quantidadeEntrada(item.quantidade, fator)
    if (quantidade <= 0) throw new ErroNegocio(`Item ${item.numero}: quantidade zerada; confira o fator`)
    if (produto.unidade === 'UN' && quantidade % 1000 !== 0) {
      throw new ErroNegocio(
        `Item ${item.numero} (${item.descricao}): daria ${quantidade / 1000} un de "${produto.descricao}". ` +
          'Produto vendido por unidade precisa de quantidade inteira: ajuste o fator.'
      )
    }
    let precoVenda: number | null = null
    if (d.precoVenda !== null && d.precoVenda !== undefined) {
      if (!Number.isSafeInteger(d.precoVenda) || d.precoVenda <= 0 || d.precoVenda > PRECO_MAXIMO) {
        throw new ErroNegocio(`Item ${item.numero}: preço de venda inválido`)
      }
      precoVenda = d.precoVenda
    }
    // Validade: a digitada na conferência manda; senão, a menor do <rastro> da nota.
    const daNota = item.lotes.map((l) => l.validade).filter((v): v is string => !!v).sort()[0] ?? null
    const validade = d.validade ? validarData(d.validade, `Item ${item.numero}: validade`) : daNota
    confirmados.push({ item, produto, fator, quantidade, custo: custoUnitario(item.custoTotal, quantidade), precoVenda, validade })
  }
  if (confirmados.length === 0) throw new ErroNegocio('Nenhum item para dar entrada')
  return confirmados
}

/**
 * Dá entrada na nota: soma ao estoque, atualiza o custo (e o preço, se pedido),
 * guarda o vínculo com o fornecedor para a próxima nota. Tudo ou nada.
 */
export function confirmarEntrada(db: Banco, nota: NotaFiscal, decisoes: unknown): ResumoEntrada {
  return emTransacao(db, () => {
    const repetida = db.prepare('SELECT id, criado_em FROM entradas WHERE chave = ?').get(nota.chave) as
      | { id: number; criado_em: string }
      | undefined
    if (repetida) throw new ErroNegocio(`Esta nota já entrou no estoque (entrada nº ${repetida.id})`)

    const itens = validarDecisoes(db, nota, decisoes)
    const { emitente } = nota

    db.prepare(
      `INSERT INTO fornecedores (cnpj, razao_social, nome_fantasia, telefone) VALUES (?, ?, ?, ?)
       ON CONFLICT (cnpj) DO UPDATE SET razao_social = excluded.razao_social,
         nome_fantasia = COALESCE(excluded.nome_fantasia, nome_fantasia),
         telefone = COALESCE(excluded.telefone, telefone)`
    ).run(emitente.cnpj, emitente.razaoSocial, emitente.nomeFantasia, emitente.telefone)
    const fornecedorId = idFornecedor(db, emitente.cnpj)!

    const entradaId = Number(
      db
        .prepare(
          `INSERT INTO entradas (fornecedor_id, chave, numero, serie, emissao, valor_total) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(fornecedorId, nota.chave, nota.numero, nota.serie, nota.emissao || null, nota.valorTotal).lastInsertRowid
    )

    const inserirItem = db.prepare(
      `INSERT INTO entrada_itens (entrada_id, numero_item, produto_id, codigo_fornecedor, descricao_nota,
         quantidade, custo_unitario, custo_total, lote, validade)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const atualizarCusto = db.prepare(
      `UPDATE produtos SET preco_custo = ?, atualizado_em = ${AGORA} WHERE id = ?`
    )
    const atualizarPreco = db.prepare(
      `UPDATE produtos SET preco_venda = ?, preco_alterado_em = ${AGORA} WHERE id = ? AND preco_venda <> ?`
    )
    const salvarVinculo = db.prepare(
      `INSERT INTO produto_fornecedor (fornecedor_id, codigo, produto_id, fator, ultimo_custo) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (fornecedor_id, codigo) DO UPDATE SET produto_id = excluded.produto_id, fator = excluded.fator,
         ultimo_custo = excluded.ultimo_custo, atualizado_em = ${AGORA}`
    )

    for (const c of itens) {
      const lote = c.item.lotes.map((l) => l.lote).filter(Boolean).join(', ') || null
      const validade = c.validade
      inserirItem.run(
        entradaId,
        c.item.numero,
        c.produto.id,
        c.item.codigo,
        c.item.descricao,
        c.quantidade,
        c.custo,
        c.item.custoTotal,
        lote,
        validade
      )
      movimentarEstoque(db, c.produto.id, c.quantidade, 'entrada', { entradaId })
      if (validade) registrarLote(db, { produtoId: c.produto.id, lote, validade, quantidade: c.quantidade, entradaId })
      atualizarCusto.run(c.custo, c.produto.id)
      if (c.precoVenda !== null) atualizarPreco.run(c.precoVenda, c.produto.id, c.precoVenda)
      salvarVinculo.run(fornecedorId, c.item.codigo, c.produto.id, c.fator, c.custo)
    }

    return listarEntradas(db, 1)[0]!
  })
}

export function listarEntradas(db: Banco, limite = 50): ResumoEntrada[] {
  return db
    .prepare(
      `SELECT e.id, COALESCE(f.nome_fantasia, f.razao_social) AS fornecedor, e.numero, e.serie, e.emissao,
         e.valor_total AS valorTotal, e.criado_em AS criadoEm,
         (SELECT count(*) FROM entrada_itens i WHERE i.entrada_id = e.id) AS itens
       FROM entradas e JOIN fornecedores f ON f.id = e.fornecedor_id
       ORDER BY e.id DESC LIMIT ?`
    )
    .all(limite) as unknown as ResumoEntrada[]
}
