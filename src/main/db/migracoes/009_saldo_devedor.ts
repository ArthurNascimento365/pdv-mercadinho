import type { Migracao } from '../migracoes'

export const m009SaldoDevedor: Migracao = {
  versao: 9,
  nome: 'saldo_devedor',
  sql: `
    -- Venda finalizada com parte em aberto, sem cliente (o cupom mostra "SALDO DEVEDOR").
    ALTER TABLE vendas ADD COLUMN saldo_devedor INTEGER NOT NULL DEFAULT 0 CHECK (saldo_devedor >= 0);
  `
}
