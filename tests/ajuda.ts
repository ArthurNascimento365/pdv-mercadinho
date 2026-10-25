import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { digitoVerificador } from '@shared/ean'
import type { ProdutoEntrada } from '@shared/produtos'

/** NF-e de exemplo: item em caixa com IPI/ST/lote, item simples e item SEM GTIN. */
export const XML_EXEMPLO = readFileSync(join(__dirname, 'fixtures', 'nfe-exemplo.xml'), 'utf8')

/** Completa um corpo de código com o dígito verificador correto. */
export const comDv = (corpo: string): string => corpo + digitoVerificador(corpo)

export function entrada(extra: Partial<ProdutoEntrada> = {}): ProdutoEntrada {
  return {
    ean: null,
    codigoBalanca: null,
    descricao: 'Arroz Tipo 1 5kg',
    unidade: 'UN',
    precoVenda: 2799,
    precoCusto: 2100,
    categoria: 'Mercearia',
    estoqueAtual: 10_000,
    estoqueMinimo: 3_000,
    ...extra
  }
}
