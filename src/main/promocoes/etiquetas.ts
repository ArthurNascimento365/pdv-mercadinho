import { svgEan } from '@shared/codigoBarras'
import { formatarMoeda, quantidadeParaTexto } from '@shared/dinheiro'
import { hojeLocal, precoTabela, promocaoAtiva } from '@shared/precos'
import type { Produto } from '@shared/produtos'
import { escaparHtml } from '@shared/texto'
import type { Banco } from '../db/conexao'
import { ErroNegocio, exigirId } from '../erros'
import { definirConfig, obterConfig } from '../repos/configuracoes'
import { obterProduto } from '../repos/produtos'

const CHAVE_ULTIMA = 'etiquetas.ultima_impressao'

export function ultimaImpressaoEtiquetas(db: Banco): string | null {
  return obterConfig(db, CHAVE_ULTIMA)
}

export function marcarEtiquetasImpressas(db: Banco, quando = new Date()): void {
  definirConfig(db, CHAVE_ULTIMA, quando.toISOString())
}

/**
 * Produtos cuja etiqueta de gôndola mudou desde `desde`: preço/promoção/atacarejo alterados
 * no cadastro, promoção que começou ou terminou no período (o preço da prateleira muda sozinho).
 */
export function produtosParaEtiqueta(db: Banco, desde: unknown, hoje = hojeLocal()): Produto[] {
  if (typeof desde !== 'string' || Number.isNaN(Date.parse(desde))) throw new ErroNegocio('Data inválida')
  const desdeIso = new Date(desde).toISOString()
  const d = new Date(desde)
  const desdeDia = hojeLocal(d)
  const ids = db
    .prepare(
      `SELECT id FROM produtos
       WHERE ativo = 1 AND (
         preco_alterado_em >= :desde
         OR (promocao_inicio IS NOT NULL AND promocao_inicio >= :desdeDia AND promocao_inicio <= :hoje)
         OR (promocao_fim IS NOT NULL AND promocao_fim >= date(:desdeDia, '-1 day') AND promocao_fim < :hoje)
       )
       ORDER BY descricao_busca`
    )
    .all({ desde: desdeIso, desdeDia, hoje }) as { id: number }[]
  return ids.map((l) => obterProduto(db, l.id)!)
}

export function produtosPorIds(db: Banco, ids: unknown): Produto[] {
  if (!Array.isArray(ids) || ids.length === 0) throw new ErroNegocio('Escolha ao menos um produto')
  if (ids.length > 500) throw new ErroNegocio('No máximo 500 etiquetas por vez')
  return ids.map((id) => {
    const p = obterProduto(db, exigirId(id))
    if (!p) throw new ErroNegocio('Produto não encontrado')
    return p
  })
}

const real = (c: number): string => formatarMoeda(c).replace(/ /g, ' ')
const diaMes = (aaaammdd: string): string => aaaammdd.split('-').reverse().slice(0, 2).join('/')

/** Conteúdo de uma etiqueta: preço de hoje, oferta (de/por, validade) e atacarejo. */
function etiqueta(p: Produto, hoje: string): string {
  const { preco } = precoTabela(p, hoje)
  const promo = promocaoAtiva(p, hoje)
  const un = p.unidade === 'KG' ? '/kg' : ''
  const barras = p.ean ? svgEan(p.ean) : null
  const atacado =
    p.atacadoQuantidade !== null && p.atacadoPreco !== null && p.atacadoPreco < preco
      ? `<div class="atacado">A partir de ${quantidadeParaTexto(p.atacadoQuantidade, p.unidade)} ${p.unidade === 'KG' ? 'kg' : 'un'}: <b>${real(p.atacadoPreco)}${un}</b></div>`
      : ''
  return `<div class="etq${promo ? ' oferta' : ''}">
    ${promo ? `<div class="selo">OFERTA até ${diaMes(p.promocaoFim!)}</div>` : ''}
    <div class="desc">${escaparHtml(p.descricao)}</div>
    ${promo ? `<div class="de">de ${real(p.precoVenda)}${un}</div>` : ''}
    <div class="preco">${real(preco)}<small>${un}</small></div>
    ${atacado}
    <div class="rodape">${barras ?? (p.codigoBalanca !== null ? `<span class="plu">PLU ${p.codigoBalanca}</span>` : '')}</div>
  </div>`
}

/**
 * Folha A4 com etiquetas de 63,5 × 38,1 mm (3 × 7, padrão Pimaco A4256/6180). Também serve
 * para imprimir em papel comum e recortar.
 */
export function htmlEtiquetas(produtos: Produto[], hoje = hojeLocal()): string {
  return `<!doctype html><meta charset="utf-8"><style>
    @page { size: A4; margin: 0; }
    body { margin: 0; font-family: Arial, 'Segoe UI', sans-serif; }
    .folha { display: grid; grid-template-columns: repeat(3, 63.5mm); grid-auto-rows: 38.1mm; column-gap: 2.5mm;
      padding: 15.1mm 7.2mm 0; box-sizing: border-box; width: 210mm; }
    .folha:not(:last-child) { page-break-after: always; }
    .etq { box-sizing: border-box; border: 0.2mm dashed #bbb; padding: 2mm 2.5mm; display: flex; flex-direction: column; overflow: hidden; position: relative; }
    .desc { font-size: 9pt; font-weight: bold; line-height: 1.15; max-height: 2.3em; overflow: hidden; text-transform: uppercase; }
    .preco { font-size: 22pt; font-weight: 900; line-height: 1; margin-top: 1mm; }
    .preco small { font-size: 10pt; font-weight: bold; }
    .de { font-size: 8pt; text-decoration: line-through; color: #555; margin-top: 0.5mm; }
    .oferta { border: 0.6mm solid #c00; } .oferta .preco { color: #c00; }
    .selo { align-self: flex-start; background: #c00; color: #fff; font-size: 7pt; font-weight: bold; padding: 0.3mm 1.5mm; margin-bottom: 0.8mm; }
    .oferta .desc { max-height: 1.15em; }
    .oferta .rodape svg { height: 9mm; }
    .atacado { font-size: 7.5pt; margin-top: 0.5mm; }
    .rodape { margin-top: auto; display: flex; justify-content: center; }
    .plu { font-size: 8pt; color: #333; }
  </style>${chunk(produtos, 21)
    .map((pagina) => `<div class="folha">${pagina.map((p) => etiqueta(p, hoje)).join('')}</div>`)
    .join('')}`
}

function chunk<T>(lista: T[], n: number): T[][] {
  const r: T[][] = []
  for (let i = 0; i < lista.length; i += n) r.push(lista.slice(i, i + n))
  return r
}
