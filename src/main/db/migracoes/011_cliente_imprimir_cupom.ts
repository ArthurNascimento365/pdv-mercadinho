import type { Migracao } from '../migracoes'

export const m011ClienteImprimirCupom: Migracao = {
  versao: 11,
  nome: 'cliente_imprimir_cupom',
  sql: `
    -- 0 = venda com este cliente não imprime nada sozinha (cupom nem via do fiado); F12 imprime.
    ALTER TABLE clientes ADD COLUMN imprimir_cupom INTEGER NOT NULL DEFAULT 1 CHECK (imprimir_cupom IN (0, 1));
  `
}
