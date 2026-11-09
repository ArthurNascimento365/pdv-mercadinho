import type { Migracao } from '../migracoes'

export const m010Acrescimo: Migracao = {
  versao: 10,
  nome: 'acrescimo',
  sql: `
    -- Acréscimo no total da venda (em reais; a porcentagem vira valor na hora de lançar).
    ALTER TABLE vendas ADD COLUMN acrescimo INTEGER NOT NULL DEFAULT 0 CHECK (acrescimo >= 0);
  `
}
