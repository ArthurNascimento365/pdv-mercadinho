import type { Migracao } from '../migracoes'

export const m001Inicial: Migracao = {
  versao: 1,
  nome: 'inicial',
  sql: `
    CREATE TABLE configuracoes (
      chave         TEXT PRIMARY KEY,
      valor         TEXT NOT NULL,
      atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT;

    INSERT INTO configuracoes (chave, valor) VALUES ('loja.nome', 'Mercadinho');
  `
}
