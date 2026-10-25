import { FORMATO_BALANCA_PADRAO, type FormatoBalanca } from '@shared/balanca'
import type { Banco } from '../db/conexao'
import { emTransacao } from '../db/transacao'
import { ErroNegocio } from '../erros'

export function obterConfig(db: Banco, chave: string): string | null {
  const linha = db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave) as
    | { valor: string }
    | undefined
  return linha?.valor ?? null
}

export function definirConfig(db: Banco, chave: string, valor: string): void {
  db.prepare(
    `INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
     ON CONFLICT (chave) DO UPDATE SET
       valor = excluded.valor,
       atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  ).run(chave, valor)
}

export function obterFormatoBalanca(db: Banco): FormatoBalanca {
  const digitos = Number(obterConfig(db, 'balanca.digitos_codigo'))
  const tipo = obterConfig(db, 'balanca.tipo_valor')
  return {
    digitosCodigo: digitos === 4 || digitos === 5 || digitos === 6 ? digitos : FORMATO_BALANCA_PADRAO.digitosCodigo,
    tipoValor: tipo === 'peso' || tipo === 'preco' ? tipo : FORMATO_BALANCA_PADRAO.tipoValor
  }
}

export function definirFormatoBalanca(db: Banco, dado: unknown): void {
  const f = (dado ?? {}) as Partial<Record<keyof FormatoBalanca, unknown>>
  if (f.digitosCodigo !== 4 && f.digitosCodigo !== 5 && f.digitosCodigo !== 6) {
    throw new ErroNegocio('Dígitos do código da balança devem ser 4, 5 ou 6')
  }
  if (f.tipoValor !== 'preco' && f.tipoValor !== 'peso') {
    throw new ErroNegocio('A etiqueta deve trazer preço ou peso')
  }
  const { digitosCodigo, tipoValor } = f
  emTransacao(db, () => {
    definirConfig(db, 'balanca.digitos_codigo', String(digitosCodigo))
    definirConfig(db, 'balanca.tipo_valor', tipoValor)
  })
}
