/**
 * Erro de regra de negócio: a mensagem é mostrada ao operador como está.
 * `codigo` "gerente" = a operação pode ser liberada com a senha do gerente.
 */
export class ErroNegocio extends Error {
  override name = 'ErroNegocio'
  constructor(
    mensagem: string,
    readonly codigo: 'gerente' | null = null
  ) {
    super(mensagem)
  }
}

export function exigirTexto(valor: unknown, campo: string, { max = 500 } = {}): string {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > max) {
    throw new ErroNegocio(`Campo inválido: ${campo}`)
  }
  return valor
}

export function exigirId(valor: unknown): number {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < 1) {
    throw new ErroNegocio('Identificador inválido')
  }
  return valor
}
