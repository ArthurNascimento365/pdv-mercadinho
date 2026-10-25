import type { Centavos, Milesimos } from './dinheiro'

export type Unidade = 'UN' | 'KG'

export interface Produto {
  id: number
  ean: string | null
  /** Código (PLU) programado na balança para itens pesados. */
  codigoBalanca: number | null
  descricao: string
  unidade: Unidade
  precoVenda: Centavos
  precoCusto: Centavos | null
  categoriaId: number | null
  categoria: string | null
  estoqueAtual: Milesimos
  estoqueMinimo: Milesimos
  ativo: boolean
  criadoEm: string
  atualizadoEm: string
  /** Última mudança de preço de venda (base das etiquetas de gôndola). */
  precoAlteradoEm: string
  precoPromocional: Centavos | null
  promocaoInicio: string | null
  promocaoFim: string | null
  atacadoQuantidade: Milesimos | null
  atacadoPreco: Centavos | null
}

/** O que o formulário (ou a importação) manda para criar/atualizar um produto. */
export interface ProdutoEntrada {
  ean: string | null
  codigoBalanca: number | null
  descricao: string
  unidade: Unidade
  precoVenda: Centavos
  precoCusto: Centavos | null
  categoria: string | null
  estoqueAtual: Milesimos
  estoqueMinimo: Milesimos
  /** Promoção: preço menor com data de início e fim (AAAA-MM-DD). Ausente = sem promoção. */
  precoPromocional?: Centavos | null
  promocaoInicio?: string | null
  promocaoFim?: string | null
  /** Atacarejo: a partir desta quantidade na venda, este preço. */
  atacadoQuantidade?: Milesimos | null
  atacadoPreco?: Centavos | null
}

export interface Categoria {
  id: number
  nome: string
}

/** Qual das bases Open Facts respondeu. */
export type BaseOpenFacts = 'alimentos' | 'beleza' | 'pet' | 'produtos'

export const NOMES_BASES_OPEN_FACTS: Record<BaseOpenFacts, string> = {
  alimentos: 'Open Food Facts',
  beleza: 'Open Beauty Facts',
  pet: 'Open Pet Food Facts',
  produtos: 'Open Products Facts'
}

/** Dados que as bases Open Facts devolveram, para pré-preencher o cadastro. */
export interface SugestaoProduto {
  ean: string
  descricao: string
  marca: string | null
  base: BaseOpenFacts
}

export type ResultadoConsultaEan =
  | { origem: 'local'; produto: Produto }
  | { origem: 'openfoodfacts'; sugestao: SugestaoProduto }
  | { origem: 'manual'; motivo: 'nao-encontrado' | 'sem-internet' | 'ean-invalido' }

/**
 * O que o leitor resolveu: um EAN cadastrado, uma etiqueta de balança ou o código
 * da balança (PLU) digitado à mão.
 */
export interface CodigoResolvido {
  origem: 'ean' | 'balanca' | 'plu'
  produto: Produto
  /** Quantidade lida da etiqueta; null = o caixa usa a quantidade padrão (1 un). */
  quantidade: Milesimos | null
  /** Total impresso na etiqueta (balança por preço); null = calcular preço × quantidade. */
  total: Centavos | null
}

export interface LinhaImportacao {
  linha: number
  acao: 'criar' | 'atualizar'
  produtoId: number | null
  entrada: ProdutoEntrada
}

export interface ErroImportacao {
  linha: number
  mensagem: string
}

export interface PreviaImportacao {
  id: string
  arquivo: string
  totalLinhas: number
  criar: number
  atualizar: number
  /** Primeiras linhas válidas, para conferência na tela. */
  amostra: LinhaImportacao[]
  erros: ErroImportacao[]
}

export interface ResultadoImportacao {
  criados: number
  atualizados: number
}
