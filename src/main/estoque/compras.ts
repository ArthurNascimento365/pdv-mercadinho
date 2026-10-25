import { formatarMoeda, quantidadeParaTexto } from '@shared/dinheiro'
import type { GrupoCompra, ItemCompra, ListaCompras } from '@shared/estoque'
import { linkWhatsApp } from '@shared/fiado'
import type { Unidade } from '@shared/produtos'
import { escaparHtml } from '@shared/texto'
import type { Banco } from '../db/conexao'
import { ErroNegocio } from '../erros'
import { definirConfig, obterConfig } from '../repos/configuracoes'

const DIA_MS = 86_400_000
const JANELA_MEDIA_DIAS = 30

export function diasCobertura(db: Banco): number {
  const n = Number(obterConfig(db, 'compras.dias_cobertura'))
  return Number.isInteger(n) && n > 0 ? n : 7
}

export function definirDiasCobertura(db: Banco, dias: unknown): void {
  if (typeof dias !== 'number' || !Number.isInteger(dias) || dias < 1 || dias > 90) {
    throw new ErroNegocio('Dias de cobertura: de 1 a 90')
  }
  definirConfig(db, 'compras.dias_cobertura', String(dias))
}

/**
 * Sugestão de compra dos produtos no estoque mínimo, agrupada por fornecedor (o da última
 * nota em que o produto veio). Quantidade = média diária × dias de cobertura − estoque,
 * no mínimo o que falta para o mínimo e pelo menos uma unidade/embalagem; arredonda para
 * unidade inteira ou embalagem fechada.
 */
export function listaCompras(db: Banco, dias = diasCobertura(db), agora = new Date()): ListaCompras {
  const desde = new Date(agora.getTime() - JANELA_MEDIA_DIAS * DIA_MS).toISOString()
  const linhas = db
    .prepare(
      `SELECT p.id, p.descricao, p.unidade, p.estoque_atual, p.estoque_minimo, p.preco_custo,
         (SELECT COALESCE(-SUM(m.quantidade), 0) FROM movimentos_estoque m
          WHERE m.produto_id = p.id AND m.tipo IN ('venda', 'cancelamento_venda') AND m.criado_em >= ?) AS vendido,
         pf.fornecedor_id, pf.codigo, pf.fator, pf.ultimo_custo,
         COALESCE(f.nome_fantasia, f.razao_social) AS fornecedor, f.telefone
       FROM produtos p
       LEFT JOIN produto_fornecedor pf ON pf.rowid = (
         SELECT rowid FROM produto_fornecedor WHERE produto_id = p.id ORDER BY atualizado_em DESC LIMIT 1)
       LEFT JOIN fornecedores f ON f.id = pf.fornecedor_id
       WHERE p.ativo = 1 AND p.estoque_minimo > 0 AND p.estoque_atual <= p.estoque_minimo
       ORDER BY fornecedor, p.descricao_busca`
    )
    .all(desde) as unknown as {
    id: number
    descricao: string
    unidade: Unidade
    estoque_atual: number
    estoque_minimo: number
    preco_custo: number | null
    vendido: number
    fornecedor_id: number | null
    codigo: string | null
    fator: number | null
    ultimo_custo: number | null
    fornecedor: string | null
    telefone: string | null
  }[]

  const grupos = new Map<string, GrupoCompra>()
  for (const l of linhas) {
    const media = Math.max(0, l.vendido) / JANELA_MEDIA_DIAS
    const fator = l.fator ?? 1
    const pacote = Math.round(fator * 1000) // milésimos de unidade de venda por embalagem
    const estoque = Math.max(0, l.estoque_atual)
    const bruto = Math.max(Math.ceil(media * dias) - estoque, l.estoque_minimo - estoque, pacote)
    let sugerido: number
    let embalagens: number | null = null
    if (fator > 1) {
      embalagens = Math.ceil(bruto / pacote)
      sugerido = embalagens * pacote
    } else {
      sugerido = l.unidade === 'UN' ? Math.ceil(bruto / 1000) * 1000 : Math.ceil(bruto / 100) * 100
    }
    const custoUnitario = l.ultimo_custo ?? l.preco_custo
    const item: ItemCompra = {
      produtoId: l.id,
      descricao: l.descricao,
      unidade: l.unidade,
      estoque: l.estoque_atual,
      minimo: l.estoque_minimo,
      mediaDiaria: Math.round(media),
      sugerido,
      codigoFornecedor: l.codigo,
      fator,
      embalagens,
      custoUnitario,
      custoEstimado: custoUnitario === null ? null : Math.round((custoUnitario * sugerido) / 1000)
    }
    const chave = String(l.fornecedor_id ?? 'sem')
    const g = grupos.get(chave) ?? {
      fornecedorId: l.fornecedor_id,
      fornecedor: l.fornecedor ?? 'Sem fornecedor (produto nunca entrou por nota)',
      telefone: l.telefone,
      itens: [],
      custoEstimado: 0
    }
    g.itens.push(item)
    g.custoEstimado += item.custoEstimado ?? 0
    grupos.set(chave, g)
  }
  // Sem fornecedor vai por último.
  const lista = [...grupos.values()].sort((a, b) => Number(a.fornecedorId === null) - Number(b.fornecedorId === null))
  return { diasCobertura: dias, grupos: lista }
}

export function textoQuantidade(i: ItemCompra): string {
  const un = i.unidade === 'KG' ? 'kg' : 'un'
  if (i.embalagens !== null) return `${i.embalagens} emb. de ${String(i.fator).replace('.', ',')} ${un}`
  return `${quantidadeParaTexto(i.sugerido, i.unidade)} ${un}`
}

const html = escaparHtml

/** Lista de compras em HTML (vira PDF A4 para imprimir ou mandar ao representante). */
export function htmlListaCompras(lista: ListaCompras, loja: string, agora = new Date()): string {
  const real = (c: number | null): string => (c === null ? '—' : formatarMoeda(c).replace(/ /g, ' '))
  const grupos = lista.grupos
    .map(
      (g) => `
    <h2>${html(g.fornecedor)}${g.telefone ? ` <small>· ${html(g.telefone)}</small>` : ''}</h2>
    <table>
      <thead><tr><th>Produto</th><th>Cód. forn.</th><th class="n">Estoque</th><th class="n">Mínimo</th>
        <th class="n">Venda/dia</th><th>Pedir</th><th class="n">Custo est.</th></tr></thead>
      <tbody>${g.itens
        .map(
          (i) => `<tr><td>${html(i.descricao)}</td><td>${html(i.codigoFornecedor ?? '')}</td>
          <td class="n">${quantidadeParaTexto(i.estoque, i.unidade)}</td><td class="n">${quantidadeParaTexto(i.minimo, i.unidade)}</td>
          <td class="n">${quantidadeParaTexto(i.mediaDiaria, i.unidade)}</td><td><b>${html(textoQuantidade(i))}</b></td>
          <td class="n">${real(i.custoEstimado)}</td></tr>`
        )
        .join('')}</tbody>
      <tfoot><tr><td colspan="6">Total estimado</td><td class="n">${real(g.custoEstimado)}</td></tr></tfoot>
    </table>`
    )
    .join('')
  return `<!doctype html><meta charset="utf-8"><style>
    body { font: 10pt 'Segoe UI', Arial, sans-serif; margin: 14mm; color: #111; }
    h1 { font-size: 16pt; margin: 0 0 2mm; } h2 { font-size: 12pt; margin: 7mm 0 2mm; } small { color: #555; font-weight: normal; }
    p { margin: 0 0 4mm; color: #444; }
    table { width: 100%; border-collapse: collapse; } th, td { padding: 1.5mm 2mm; border-bottom: 0.2mm solid #ccc; text-align: left; }
    th { background: #eee; font-size: 9pt; } .n { text-align: right; } tfoot td { font-weight: bold; border: none; }
  </style>
  <h1>Lista de compras — ${html(loja)}</h1>
  <p>${agora.toLocaleDateString('pt-BR')} · cobertura de ${lista.diasCobertura} dias · produtos no estoque mínimo</p>
  ${grupos || '<p>Nenhum produto no estoque mínimo.</p>'}`
}

/** Pedido para mandar ao representante pelo WhatsApp. */
export function pedidoWhatsApp(db: Banco, grupo: GrupoCompra): { texto: string; link: string } {
  const loja = obterConfig(db, 'loja.nome') ?? 'Mercadinho'
  const linhas = [
    `Pedido — ${loja}`,
    `Data: ${new Date().toLocaleDateString('pt-BR')}`,
    '',
    ...grupo.itens.map((i) => `• ${textoQuantidade(i)} — ${i.descricao}${i.codigoFornecedor ? ` (cód. ${i.codigoFornecedor})` : ''}`),
    '',
    grupo.custoEstimado > 0 ? `Estimativa pelo último custo: ${formatarMoeda(grupo.custoEstimado).replace(/ /g, ' ')}` : '',
    'Obrigado!'
  ].filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
  const texto = linhas.join('\n').trim()
  // Sem celular do representante: o WhatsApp abre para escolher o contato.
  return { texto, link: linkWhatsApp(grupo.telefone, texto) ?? `https://wa.me/?text=${encodeURIComponent(texto)}` }
}
