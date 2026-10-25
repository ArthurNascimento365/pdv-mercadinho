import { lerEtiquetaBalanca, type FormatoBalanca } from '@shared/balanca'
import { totalItem } from '@shared/dinheiro'
import { limparCodigo } from '@shared/ean'
import type { CodigoResolvido } from '@shared/produtos'
import type { Banco } from '../db/conexao'
import { produtoPorCodigoBalanca, produtoPorEan } from '../repos/produtos'

/**
 * Traduz o que o leitor bipou em produto (+ quantidade/total quando é etiqueta de balança).
 * O EAN cadastrado tem prioridade: só depois o código é lido como etiqueta.
 * Produtos inativos não são vendidos.
 */
export function resolverCodigo(db: Banco, lido: string, formato: FormatoBalanca): CodigoResolvido | null {
  const codigo = limparCodigo(lido)
  if (!/^\d+$/.test(codigo)) return null

  const porEan = produtoPorEan(db, codigo)
  if (porEan) return porEan.ativo ? { origem: 'ean', produto: porEan, quantidade: null, total: null } : null

  // Até 6 dígitos: o operador digitou o código da balança (ex.: "12" para banana).
  if (codigo.length <= 6) {
    const porPlu = produtoPorCodigoBalanca(db, Number(codigo))
    return porPlu?.ativo ? { origem: 'plu', produto: porPlu, quantidade: null, total: null } : null
  }

  const etiqueta = lerEtiquetaBalanca(codigo, formato)
  if (!etiqueta) return null

  const produto = produtoPorCodigoBalanca(db, etiqueta.codigoProduto)
  if (!produto || !produto.ativo) return null

  if (formato.tipoValor === 'peso') {
    return {
      origem: 'balanca',
      produto,
      quantidade: etiqueta.valor,
      total: totalItem(produto.precoVenda, etiqueta.valor)
    }
  }
  // Etiqueta por preço: o total impresso manda; a quantidade é derivada só para estoque e relatório.
  return {
    origem: 'balanca',
    produto,
    quantidade: Math.max(1, Math.round((etiqueta.valor * 1000) / produto.precoVenda)),
    total: etiqueta.valor
  }
}
