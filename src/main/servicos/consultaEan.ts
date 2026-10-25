import { eanValido, limparCodigo } from '@shared/ean'
import type { ResultadoConsultaEan, SugestaoProduto } from '@shared/produtos'
import type { Banco } from '../db/conexao'
import { produtoPorEan } from '../repos/produtos'
import { SemConexao } from './openFoodFacts'

export type ConsultaRemota = (ean: string) => Promise<SugestaoProduto | null>

/** Cadastro por EAN: primeiro o banco local, depois o Open Food Facts, por fim digitação manual. */
export async function consultarEan(
  db: Banco,
  codigo: string,
  consultarRemoto: ConsultaRemota
): Promise<ResultadoConsultaEan> {
  const ean = limparCodigo(codigo)
  if (!eanValido(ean)) return { origem: 'manual', motivo: 'ean-invalido' }

  const local = produtoPorEan(db, ean)
  if (local) return { origem: 'local', produto: local }

  try {
    const sugestao = await consultarRemoto(ean)
    if (sugestao) return { origem: 'openfoodfacts', sugestao }
    return { origem: 'manual', motivo: 'nao-encontrado' }
  } catch (erro) {
    if (erro instanceof SemConexao) return { origem: 'manual', motivo: 'sem-internet' }
    throw erro
  }
}
