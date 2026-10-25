import type { BaseOpenFacts, SugestaoProduto } from '@shared/produtos'
import { limparEspacos, normalizarBusca } from '@shared/texto'

export type Buscador = (url: string, init: RequestInit) => Promise<Response>

export class SemConexao extends Error {
  override name = 'SemConexao'
}

// Categoria fica de fora: a do OFF costuma vir em inglês e não bate com as categorias da loja.
const CAMPOS = 'product_name_pt,product_name,brands,quantity,product_type'
const USER_AGENT = 'PDV-Mercadinho/0.1 (desktop; offline-first)'

/** product_type do Open Food Facts → base de onde veio o dado. */
const BASES: Record<string, BaseOpenFacts> = {
  food: 'alimentos',
  beauty: 'beleza',
  petfood: 'pet',
  product: 'produtos'
}

interface RespostaOff {
  status?: number
  product?: {
    product_name_pt?: string
    product_name?: string
    brands?: string
    quantity?: string
    product_type?: string
  }
}

/**
 * Consulta o produto nas bases Open Facts. Com `product_type=all`, a mesma chamada cobre
 * alimentos, higiene/cosméticos (Open Beauty Facts), ração (Open Pet Food Facts) e limpeza e
 * outros (Open Products Facts): o servidor redireciona para a base onde o código existe.
 * Retorna null se não existir em nenhuma. Lança SemConexao se não deu para falar com o
 * serviço (offline, timeout, erro 5xx).
 */
export async function consultarOpenFoodFacts(
  ean: string,
  buscar: Buscador,
  { timeoutMs = 8000 } = {}
): Promise<SugestaoProduto | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}?fields=${CAMPOS}&product_type=all`
  let resposta: Response
  try {
    resposta = await buscar(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (erro) {
    throw new SemConexao(erro instanceof Error ? erro.message : String(erro))
  }

  if (resposta.status === 404) return null
  if (!resposta.ok) throw new SemConexao(`Open Food Facts respondeu ${resposta.status}`)

  const corpo = (await resposta.json()) as RespostaOff
  const p = corpo.product
  if (corpo.status !== 1 || !p) return null

  const nome = limparEspacos(p.product_name_pt || p.product_name || '')
  if (!nome) return null

  const marca = limparEspacos(p.brands?.split(',')[0] ?? '') || null
  const quantidade = limparEspacos(p.quantity ?? '')

  // Comparação sem acento: "Detergente Ypê" já contém a marca "Ype".
  const nomeBusca = normalizarBusca(nome)
  const partes = [nome]
  if (marca && !nomeBusca.includes(normalizarBusca(marca))) partes.push(marca)
  if (quantidade && !nomeBusca.replace(/\s/g, '').includes(normalizarBusca(quantidade).replace(/\s/g, ''))) {
    partes.push(quantidade)
  }

  return {
    ean,
    descricao: partes.join(' ').slice(0, 120),
    marca,
    base: BASES[p.product_type ?? ''] ?? 'alimentos'
  }
}
