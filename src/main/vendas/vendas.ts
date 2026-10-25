import type { FormatoBalanca } from '@shared/balanca'
import { formatarMoeda, totalItem, type Centavos, type Milesimos } from '@shared/dinheiro'
import { hojeLocal, precoComAtacado, precoTabela, type TipoPreco } from '@shared/precos'
import type { Produto, Unidade } from '@shared/produtos'
import {
  formaValida,
  type ItemVenda,
  type PagamentoVenda,
  type ResultadoAdicionar,
  type Venda
} from '@shared/vendas'
import type { Banco } from '../db/conexao'
import { emTransacao } from '../db/transacao'
import { ErroNegocio, exigirId } from '../erros'
import { exigirCaixaAberto, idCaixaAberto } from '../caixa/caixa'
import { lancarFiado, obterCliente, verificarCredito } from '../fiado/fiado'
import { movimentarEstoque } from '../repos/estoque'
import { conferirSenhaGerente, temSenhaGerente } from '../seguranca'
import { obterProduto } from '../repos/produtos'
import { resolverCodigo } from '../servicos/leitorCodigo'

const AGORA = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
const QUANTIDADE_MAXIMA = 9_999_000 // 9.999 un ou kg
const PAGAMENTO_MAXIMO = 10_000_000 // R$ 100.000,00

interface LinhaVenda {
  id: number
  status: Venda['status']
  iniciada_em: string
  finalizada_em: string | null
  cancelada_em: string | null
  subtotal: number
  desconto: number
  total: number
  troco: number
  caixa_id: number | null
  cliente_id: number | null
  cliente_nome: string | null
  fiado_autorizado: number
}

interface LinhaItem {
  id: number
  sequencia: number
  produto_id: number
  descricao: string
  unidade: Unidade
  quantidade: number
  preco_unitario: number
  total_bruto: number
  desconto: number
  total: number
  cancelado: number
  preco_tabela: number | null
  tipo_preco: TipoPreco
}

export function obterVenda(db: Banco, id: number): Venda | null {
  const v = db
    .prepare(
      `SELECT v.*, c.nome AS cliente_nome FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id WHERE v.id = ?`
    )
    .get(id) as LinhaVenda | undefined
  if (!v) return null

  const itens = (
    db.prepare('SELECT * FROM venda_itens WHERE venda_id = ? ORDER BY sequencia').all(id) as unknown as LinhaItem[]
  ).map(
    (i): ItemVenda => ({
      id: i.id,
      sequencia: i.sequencia,
      produtoId: i.produto_id,
      descricao: i.descricao,
      unidade: i.unidade,
      quantidade: i.quantidade,
      precoUnitario: i.preco_unitario,
      totalBruto: i.total_bruto,
      desconto: i.desconto,
      total: i.total,
      cancelado: i.cancelado === 1,
      tipoPreco: i.tipo_preco,
      precoTabela: i.preco_tabela ?? i.preco_unitario
    })
  )
  const pagamentos = db
    .prepare('SELECT id, forma, valor FROM venda_pagamentos WHERE venda_id = ? ORDER BY id')
    .all(id) as unknown as PagamentoVenda[]
  const pago = pagamentos.reduce((s, p) => s + p.valor, 0)

  return {
    id: v.id,
    status: v.status,
    iniciadaEm: v.iniciada_em,
    finalizadaEm: v.finalizada_em,
    canceladaEm: v.cancelada_em,
    subtotal: v.subtotal,
    desconto: v.desconto,
    total: v.total,
    pago,
    restante: Math.max(0, v.total - pago),
    troco: v.troco,
    caixaId: v.caixa_id,
    clienteId: v.cliente_id,
    clienteNome: v.cliente_nome,
    itens,
    pagamentos
  }
}

function idVendaAberta(db: Banco): number | null {
  const l = db.prepare(`SELECT id FROM vendas WHERE status = 'aberta'`).get() as { id: number } | undefined
  return l?.id ?? null
}

export function vendaAberta(db: Banco): Venda | null {
  const id = idVendaAberta(db)
  return id === null ? null : obterVenda(db, id)
}

function exigirVendaAberta(db: Banco): number {
  const id = idVendaAberta(db)
  if (id === null) throw new ErroNegocio('Nenhuma venda em andamento')
  return id
}

/** Recalcula subtotal e total. O desconto da venda nunca passa do subtotal. */
function recalcular(db: Banco, vendaId: number): void {
  db.prepare(
    `UPDATE vendas SET
       subtotal = s.valor,
       desconto = MIN(desconto, s.valor),
       total = s.valor - MIN(desconto, s.valor)
     FROM (SELECT COALESCE(SUM(total), 0) AS valor FROM venda_itens WHERE venda_id = ? AND cancelado = 0) AS s
     WHERE id = ?`
  ).run(vendaId, vendaId)
}

function exigirQuantidade(produto: Produto, quantidade: unknown): Milesimos {
  if (typeof quantidade !== 'number' || !Number.isSafeInteger(quantidade) || quantidade <= 0) {
    throw new ErroNegocio('Quantidade inválida')
  }
  if (quantidade > QUANTIDADE_MAXIMA) throw new ErroNegocio('Quantidade grande demais')
  if (produto.unidade === 'UN' && quantidade % 1000 !== 0) {
    throw new ErroNegocio(`"${produto.descricao}" é vendido por unidade: use quantidade inteira`)
  }
  return quantidade
}

function inserirItem(db: Banco, produto: Produto, quantidade: Milesimos, totalEtiqueta: Centavos | null): Venda {
  return emTransacao(db, () => {
    const caixaId = exigirCaixaAberto(db)
    let vendaId = idVendaAberta(db)
    if (vendaId === null) {
      vendaId = Number(
        db.prepare(`INSERT INTO vendas (status, caixa_id) VALUES ('aberta', ?)`).run(caixaId).lastInsertRowid
      )
    }
    // Etiqueta de balança: o total impresso manda (a balança já precificou).
    const tabela = totalEtiqueta !== null ? { preco: produto.precoVenda, tipo: 'etiqueta' as const } : precoTabela(produto, hojeLocal())
    const bruto = totalEtiqueta ?? totalItem(tabela.preco, quantidade)
    if (bruto === 0) throw new ErroNegocio('Quantidade pequena demais: o item sairia de graça')

    const { proxima } = db
      .prepare('SELECT COALESCE(MAX(sequencia), 0) + 1 AS proxima FROM venda_itens WHERE venda_id = ?')
      .get(vendaId) as { proxima: number }
    db.prepare(
      `INSERT INTO venda_itens (venda_id, sequencia, produto_id, descricao, unidade, quantidade,
         preco_unitario, total_bruto, total, custo_unitario, preco_tabela, tipo_preco)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      vendaId,
      proxima,
      produto.id,
      produto.descricao,
      produto.unidade,
      quantidade,
      tabela.preco,
      bruto,
      bruto,
      produto.precoCusto,
      tabela.preco,
      tabela.tipo
    )
    reprecificarAtacado(db, vendaId, produto)
    recalcular(db, vendaId)
    return obterVenda(db, vendaId)!
  })
}

/**
 * Atacarejo pela quantidade total do produto na venda (bipar 3 vezes = "3*código"):
 * passou do mínimo, todos os itens dele vão para o preço de atacado; caiu (item
 * cancelado), voltam ao preço de tabela. Itens de etiqueta de balança não mudam.
 */
function reprecificarAtacado(db: Banco, vendaId: number, produto: Produto): void {
  if (produto.atacadoQuantidade === null || produto.atacadoPreco === null) return
  const itens = db
    .prepare(
      `SELECT id, quantidade, preco_tabela, desconto FROM venda_itens
       WHERE venda_id = ? AND produto_id = ? AND cancelado = 0 AND tipo_preco <> 'etiqueta'`
    )
    .all(vendaId, produto.id) as unknown as { id: number; quantidade: number; preco_tabela: number; desconto: number }[]
  const total = itens.reduce((s, i) => s + i.quantidade, 0)
  const atualizar = db.prepare(
    `UPDATE venda_itens SET preco_unitario = ?, total_bruto = ?, desconto = ?, total = ?, tipo_preco = ? WHERE id = ?`
  )
  for (const i of itens) {
    const { preco, atacado } = precoComAtacado(produto, i.preco_tabela, total)
    const bruto = totalItem(preco, i.quantidade)
    const desconto = Math.min(i.desconto, bruto)
    const tipo = atacado ? 'atacado' : i.preco_tabela < produto.precoVenda ? 'promocao' : 'normal'
    atualizar.run(preco, bruto, desconto, bruto - desconto, tipo, i.id)
  }
}

/**
 * Item bipado ou digitado no caixa. `quantidade` vem do multiplicador ("3*codigo").
 * Abre a venda no primeiro item.
 */
export function adicionarPorCodigo(
  db: Banco,
  codigo: string,
  quantidade: Milesimos | null,
  formato: FormatoBalanca
): ResultadoAdicionar {
  const r = resolverCodigo(db, codigo, formato)
  if (!r) return { tipo: 'naoEncontrado', codigo }

  if (r.origem === 'balanca') {
    if (quantidade !== null) throw new ErroNegocio('Multiplicador não vale para etiqueta de balança')
    return { tipo: 'adicionado', venda: inserirItem(db, r.produto, r.quantidade!, r.total) }
  }
  if (quantidade === null && r.produto.unidade === 'KG') return { tipo: 'pedirQuantidade', produto: r.produto }
  return {
    tipo: 'adicionado',
    venda: inserirItem(db, r.produto, exigirQuantidade(r.produto, quantidade ?? 1000), null)
  }
}

/** Item escolhido pela busca por nome ou com peso informado à mão. */
export function adicionarProduto(db: Banco, produtoId: unknown, quantidade: unknown): Venda {
  const produto = obterProduto(db, exigirId(produtoId))
  if (!produto || !produto.ativo) throw new ErroNegocio('Produto não encontrado ou inativo')
  return inserirItem(db, produto, exigirQuantidade(produto, quantidade), null)
}

function exigirCentavos(valor: unknown, campo: string): Centavos {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < 0) {
    throw new ErroNegocio(`${campo} inválido`)
  }
  return valor
}

function itemDaVendaAberta(db: Banco, itemId: unknown): LinhaItem & { venda_id: number } {
  const vendaId = exigirVendaAberta(db)
  const item = db
    .prepare('SELECT * FROM venda_itens WHERE id = ? AND venda_id = ?')
    .get(exigirId(itemId), vendaId) as (LinhaItem & { venda_id: number }) | undefined
  if (!item) throw new ErroNegocio('Item não está na venda atual')
  if (item.cancelado) throw new ErroNegocio(`Item ${item.sequencia} já foi cancelado`)
  return item
}

export function descontoItem(db: Banco, itemId: unknown, desconto: unknown): Venda {
  return emTransacao(db, () => {
    const item = itemDaVendaAberta(db, itemId)
    const valor = exigirCentavos(desconto, 'Desconto')
    if (valor > item.total_bruto) {
      throw new ErroNegocio(`Desconto maior que o item (${formatarMoeda(item.total_bruto)})`)
    }
    db.prepare('UPDATE venda_itens SET desconto = ?, total = total_bruto - ? WHERE id = ?').run(valor, valor, item.id)
    recalcular(db, item.venda_id)
    return obterVenda(db, item.venda_id)!
  })
}

export function descontoVenda(db: Banco, desconto: unknown): Venda {
  return emTransacao(db, () => {
    const vendaId = exigirVendaAberta(db)
    const valor = exigirCentavos(desconto, 'Desconto')
    const { subtotal } = db.prepare('SELECT subtotal FROM vendas WHERE id = ?').get(vendaId) as { subtotal: number }
    if (valor > subtotal) throw new ErroNegocio(`Desconto maior que a venda (${formatarMoeda(subtotal)})`)
    db.prepare('UPDATE vendas SET desconto = ? WHERE id = ?').run(valor, vendaId)
    recalcular(db, vendaId)
    return obterVenda(db, vendaId)!
  })
}

/** Item cancelado fica registrado (riscado), não é apagado. */
export function cancelarItem(db: Banco, itemId: unknown): Venda {
  return emTransacao(db, () => {
    const item = itemDaVendaAberta(db, itemId)
    db.prepare(`UPDATE venda_itens SET cancelado = 1, cancelado_em = ${AGORA} WHERE id = ?`).run(item.id)
    const produto = obterProduto(db, item.produto_id)
    if (produto) reprecificarAtacado(db, item.venda_id, produto)
    recalcular(db, item.venda_id)
    return obterVenda(db, item.venda_id)!
  })
}

export function cancelarVendaAberta(db: Banco): void {
  const vendaId = exigirVendaAberta(db)
  db.prepare(`UPDATE vendas SET status = 'cancelada', cancelada_em = ${AGORA} WHERE id = ?`).run(vendaId)
}

/** Identifica (ou tira) o cliente da venda em andamento. Necessário para o fiado. */
export function definirClienteVenda(db: Banco, clienteId: unknown): Venda {
  return emTransacao(db, () => {
    const vendaId = exigirVendaAberta(db)
    const venda = obterVenda(db, vendaId)!
    if (venda.pagamentos.some((p) => p.forma === 'fiado')) {
      throw new ErroNegocio('Remova o pagamento no fiado antes de trocar o cliente')
    }
    let id: number | null = null
    if (clienteId !== null) {
      const c = obterCliente(db, exigirId(clienteId))
      if (!c || !c.ativo) throw new ErroNegocio('Cliente não encontrado ou inativo')
      id = c.id
    }
    db.prepare('UPDATE vendas SET cliente_id = ?, fiado_autorizado = 0 WHERE id = ?').run(id, vendaId)
    return obterVenda(db, vendaId)!
  })
}

const totalFiado = (v: Venda): Centavos => v.pagamentos.filter((p) => p.forma === 'fiado').reduce((s, p) => s + p.valor, 0)

/**
 * Lança um pagamento. Fiado exige cliente e passa pela checagem de limite/atraso; se
 * bloquear, a senha do gerente (`senhaGerente`) libera esta venda.
 */
export function adicionarPagamento(db: Banco, forma: unknown, valor: unknown, senhaGerente: unknown = null): Venda {
  return emTransacao(db, () => {
    const vendaId = exigirVendaAberta(db)
    if (!formaValida(forma)) throw new ErroNegocio('Forma de pagamento inválida')
    const v = exigirCentavos(valor, 'Valor')
    if (v === 0) throw new ErroNegocio('Informe o valor')
    if (v > PAGAMENTO_MAXIMO) throw new ErroNegocio('Valor alto demais')

    const venda = obterVenda(db, vendaId)!
    if (venda.restante === 0) throw new ErroNegocio('A venda já está paga')
    // Só dinheiro pode passar do restante (gera troco); cartão, Pix e fiado são no valor exato.
    if (forma !== 'dinheiro' && v > venda.restante) {
      throw new ErroNegocio(`Valor maior que o restante (${formatarMoeda(venda.restante)})`)
    }
    if (forma === 'fiado') {
      if (venda.clienteId === null) throw new ErroNegocio('Identifique o cliente (F3) para vender no fiado')
      liberarFiado(db, vendaId, venda.clienteId, totalFiado(venda) + v, senhaGerente)
    }
    db.prepare('INSERT INTO venda_pagamentos (venda_id, forma, valor) VALUES (?, ?, ?)').run(vendaId, forma, v)
    return obterVenda(db, vendaId)!
  })
}

/** Confere o crédito; se bloquear e a senha do gerente conferir, marca a venda como liberada. */
function liberarFiado(db: Banco, vendaId: number, clienteId: number, valor: Centavos, senhaGerente: unknown): void {
  const autorizada = (db.prepare('SELECT fiado_autorizado AS a FROM vendas WHERE id = ?').get(vendaId) as { a: number }).a
  if (autorizada) return
  try {
    verificarCredito(db, clienteId, valor)
  } catch (erro) {
    if (!(erro instanceof ErroNegocio) || erro.codigo !== 'gerente') throw erro
    if (senhaGerente === null || senhaGerente === undefined || senhaGerente === '') {
      if (!temSenhaGerente(db)) {
        throw new ErroNegocio(`${erro.message}. Cadastre a senha do gerente (F9) para liberar exceções.`)
      }
      throw erro
    }
    if (!conferirSenhaGerente(db, senhaGerente)) throw new ErroNegocio('Senha do gerente incorreta', 'gerente')
    db.prepare('UPDATE vendas SET fiado_autorizado = 1 WHERE id = ?').run(vendaId)
  }
}

export function removerPagamento(db: Banco, pagamentoId: unknown): Venda {
  return emTransacao(db, () => {
    const vendaId = exigirVendaAberta(db)
    const r = db
      .prepare('DELETE FROM venda_pagamentos WHERE id = ? AND venda_id = ?')
      .run(exigirId(pagamentoId), vendaId)
    if (r.changes === 0) throw new ErroNegocio('Pagamento não está na venda atual')
    return obterVenda(db, vendaId)!
  })
}

function moverEstoque(db: Banco, vendaId: number, sinal: 1 | -1): void {
  const porProduto = db
    .prepare(
      `SELECT produto_id AS produtoId, SUM(quantidade) AS quantidade FROM venda_itens
       WHERE venda_id = ? AND cancelado = 0 GROUP BY produto_id`
    )
    .all(vendaId) as unknown as { produtoId: number; quantidade: number }[]
  for (const { produtoId, quantidade } of porProduto) {
    movimentarEstoque(db, produtoId, sinal * quantidade, sinal < 0 ? 'venda' : 'cancelamento_venda', { vendaId })
  }
}

/** Fecha a venda: confere pagamentos, calcula o troco e baixa o estoque. */
export function finalizarVenda(db: Banco): Venda {
  return emTransacao(db, () => {
    const vendaId = exigirVendaAberta(db)
    const venda = obterVenda(db, vendaId)!
    if (!venda.itens.some((i) => !i.cancelado)) throw new ErroNegocio('Venda sem itens')
    if (venda.pago < venda.total) throw new ErroNegocio(`Falta receber ${formatarMoeda(venda.total - venda.pago)}`)

    const dinheiro = venda.pagamentos.filter((p) => p.forma === 'dinheiro').reduce((s, p) => s + p.valor, 0)
    const outros = venda.pago - dinheiro
    // Itens podem ter mudado depois do pagamento: revalida o que só valia no valor exato.
    if (outros > venda.total) {
      throw new ErroNegocio('Cartão/Pix/fiado passam do total. Remova um pagamento e lance de novo.')
    }
    const troco = venda.pago - venda.total
    if (troco > dinheiro) throw new ErroNegocio('Troco maior que o dinheiro recebido')

    const caixaId = exigirCaixaAberto(db)
    const fiado = totalFiado(venda)
    if (fiado > 0) {
      if (venda.clienteId === null) throw new ErroNegocio('Venda no fiado sem cliente')
      liberarFiado(db, vendaId, venda.clienteId, fiado, null)
      const autorizado = (db.prepare('SELECT fiado_autorizado AS a FROM vendas WHERE id = ?').get(vendaId) as { a: number }).a
      lancarFiado(db, { clienteId: venda.clienteId, tipo: 'compra', valor: fiado, vendaId, caixaId, autorizado: autorizado === 1 })
    }
    db.prepare(
      `UPDATE vendas SET status = 'finalizada', finalizada_em = ${AGORA}, troco = ?, caixa_id = ? WHERE id = ?`
    ).run(troco, caixaId, vendaId)
    moverEstoque(db, vendaId, -1)
    return obterVenda(db, vendaId)!
  })
}

export function ultimaVendaFinalizada(db: Banco): Venda | null {
  const l = db
    .prepare(`SELECT id FROM vendas WHERE status = 'finalizada' ORDER BY finalizada_em DESC, id DESC LIMIT 1`)
    .get() as { id: number } | undefined
  return l ? obterVenda(db, l.id) : null
}

/** Cancela uma venda já finalizada e devolve os itens ao estoque. */
export function cancelarVendaFinalizada(db: Banco, vendaId: unknown): Venda {
  return emTransacao(db, () => {
    const id = exigirId(vendaId)
    const venda = obterVenda(db, id)
    if (!venda) throw new ErroNegocio('Venda não encontrada')
    if (venda.status !== 'finalizada') throw new ErroNegocio(`A venda ${id} não está finalizada`)
    // Mexer numa venda de caixa já fechado mudaria um fechamento já conferido.
    if (venda.caixaId !== idCaixaAberto(db)) {
      throw new ErroNegocio(`A venda ${id} é de um caixa já fechado e não pode ser cancelada`)
    }
    db.prepare(`UPDATE vendas SET status = 'cancelada', cancelada_em = ${AGORA} WHERE id = ?`).run(id)
    moverEstoque(db, id, 1)
    // O que foi para a caderneta sai dela.
    const compra = db
      .prepare(`SELECT cliente_id, valor FROM fiado_lancamentos WHERE venda_id = ? AND tipo = 'compra'`)
      .get(id) as { cliente_id: number; valor: number } | undefined
    if (compra) lancarFiado(db, { clienteId: compra.cliente_id, tipo: 'estorno', valor: compra.valor, vendaId: id })
    return obterVenda(db, id)!
  })
}
