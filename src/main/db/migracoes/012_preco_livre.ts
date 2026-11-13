import type { Migracao } from '../migracoes'

export const m012PrecoLivre: Migracao = {
  versao: 12,
  nome: 'preco_livre',
  sql: `
    -- 1 = o caixa digita o valor na hora (ex.: "DIVERSOS"); não controla estoque.
    -- preco_venda fica 1 (centavo) só para cumprir o CHECK: o que vale é o valor digitado.
    ALTER TABLE produtos ADD COLUMN preco_livre INTEGER NOT NULL DEFAULT 0 CHECK (preco_livre IN (0, 1));
  `
}
