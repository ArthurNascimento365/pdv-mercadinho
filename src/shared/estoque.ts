import type { Centavos, Milesimos } from './dinheiro'
import type { Produto, Unidade } from './produtos'

export type TipoMovimentoEstoque = 'inicial' | 'ajuste' | 'venda' | 'cancelamento_venda' | 'entrada'

export const NOMES_MOVIMENTO: Record<TipoMovimentoEstoque, string> = {
  inicial: 'Estoque inicial',
  ajuste: 'Ajuste manual',
  venda: 'Venda',
  cancelamento_venda: 'Venda cancelada',
  entrada: 'Entrada (NF-e)'
}

export interface MovimentoEstoque {
  id: number
  tipo: TipoMovimentoEstoque
  quantidade: Milesimos
  saldo: Milesimos
  vendaId: number | null
  entradaId: number | null
  criadoEm: string
}

/** Chegou no mínimo: hora de repor. Mínimo 0 = produto sem controle de mínimo. */
export function noEstoqueMinimo(p: Pick<Produto, 'estoqueAtual' | 'estoqueMinimo'>): boolean {
  return p.estoqueMinimo > 0 && p.estoqueAtual <= p.estoqueMinimo
}

// ---- Entrada de mercadoria (NF-e) ----

export interface LoteNota {
  lote: string
  validade: string | null
}

export interface ItemNota {
  numero: number
  codigo: string
  ean: string | null
  eanTributavel: string | null
  descricao: string
  unidade: string
  /** Quantidade da nota em décimos de milésimo (a NF-e usa até 4 casas): 2,5 → 25000. */
  quantidade: number
  unidadeTributavel: string
  quantidadeTributavel: number
  /** Valor que entra no custo: produto − desconto + frete + seguro + outras + IPI + ICMS-ST. */
  custoTotal: Centavos
  lotes: LoteNota[]
}

export interface NotaFiscal {
  chave: string
  numero: number
  serie: number
  emissao: string
  emitente: { cnpj: string; razaoSocial: string; nomeFantasia: string | null; telefone: string | null }
  valorTotal: Centavos
  itens: ItemNota[]
}

export interface ItemPreviaEntrada {
  item: ItemNota
  produto: Produto | null
  origem: 'vinculo' | 'ean' | 'eanTributavel' | null
  fator: number
}

export interface PreviaEntrada {
  id: string
  arquivo: string
  nota: NotaFiscal
  fornecedorCadastrado: boolean
  itens: ItemPreviaEntrada[]
}

export type DecisaoItem =
  | {
      numero: number
      acao: 'vincular'
      produtoId: number
      fator: number
      precoVenda: Centavos | null
      /** Validade digitada quando a nota não traz o grupo <rastro> (AAAA-MM-DD). */
      validade?: string | null
    }
  | { numero: number; acao: 'ignorar' }

// ---- Validade ----

export interface LoteEmEstoque {
  loteId: number
  produtoId: number
  descricao: string
  unidade: Unidade
  lote: string | null
  validade: string
  /** Quanto deste lote ainda deve estar na prateleira (FEFO: os que vencem antes saíram antes). */
  saldo: Milesimos
  /** Dias até vencer (negativo = vencido). */
  dias: number
}

export interface AlertasValidade {
  vencidos: LoteEmEstoque[]
  em7: LoteEmEstoque[]
  em30: LoteEmEstoque[]
}

// ---- Lista de compras ----

export interface ItemCompra {
  produtoId: number
  descricao: string
  unidade: Unidade
  estoque: Milesimos
  minimo: Milesimos
  /** Média vendida por dia nos últimos 30 dias (milésimos). */
  mediaDiaria: number
  /** Quanto pedir, já arredondado para unidade inteira ou embalagem fechada. */
  sugerido: Milesimos
  codigoFornecedor: string | null
  /** Unidades de venda por embalagem do fornecedor (1 = avulso). */
  fator: number
  embalagens: number | null
  custoUnitario: Centavos | null
  custoEstimado: Centavos | null
}

export interface GrupoCompra {
  fornecedorId: number | null
  fornecedor: string
  telefone: string | null
  itens: ItemCompra[]
  custoEstimado: Centavos
}

export interface ListaCompras {
  diasCobertura: number
  grupos: GrupoCompra[]
}

export interface EntradaManual {
  produtoId: number
  quantidade: Milesimos
  custoUnitario: Centavos | null
  validade: string | null
  lote: string | null
}

export interface ResumoEntrada {
  id: number
  fornecedor: string
  numero: number | null
  serie: number | null
  emissao: string | null
  valorTotal: Centavos
  itens: number
  criadoEm: string
}

/** Quanto entra no estoque (milésimos da unidade de venda) para um item com esse fator. */
export function quantidadeEntrada(quantidadeNota: number, fator: number): Milesimos {
  return Math.round((quantidadeNota * fator) / 10)
}

/** Custo por unidade de venda (centavos), já com impostos e despesas rateados no item. */
export function custoUnitario(custoTotal: Centavos, quantidade: Milesimos): Centavos {
  return quantidade > 0 ? Math.round((custoTotal * 1000) / quantidade) : 0
}

export function unidadeVenda(u: Unidade): string {
  return u === 'KG' ? 'kg' : 'un'
}
