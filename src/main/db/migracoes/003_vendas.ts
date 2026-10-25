import type { Migracao } from '../migracoes'

const AGORA = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`

export const m003Vendas: Migracao = {
  versao: 3,
  nome: 'vendas',
  sql: `
    -- A venda é gravada desde o primeiro item: se o PDV cair, ela volta aberta.
    CREATE TABLE vendas (
      id                  INTEGER PRIMARY KEY,
      status              TEXT NOT NULL CHECK (status IN ('aberta', 'finalizada', 'cancelada')),
      iniciada_em         TEXT NOT NULL DEFAULT ${AGORA},
      finalizada_em       TEXT,
      cancelada_em        TEXT,
      subtotal            INTEGER NOT NULL DEFAULT 0,
      desconto            INTEGER NOT NULL DEFAULT 0 CHECK (desconto >= 0),
      total               INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
      troco               INTEGER NOT NULL DEFAULT 0 CHECK (troco >= 0)
    ) STRICT;

    -- No máximo uma venda aberta por vez.
    CREATE UNIQUE INDEX vendas_uma_aberta ON vendas (status) WHERE status = 'aberta';
    CREATE INDEX vendas_finalizada_em ON vendas (finalizada_em);

    CREATE TABLE venda_itens (
      id              INTEGER PRIMARY KEY,
      venda_id        INTEGER NOT NULL REFERENCES vendas (id),
      sequencia       INTEGER NOT NULL,
      produto_id      INTEGER NOT NULL REFERENCES produtos (id),
      -- Cópia do cadastro no momento da venda: mudar o produto depois não altera vendas antigas.
      descricao       TEXT NOT NULL,
      unidade         TEXT NOT NULL CHECK (unidade IN ('UN', 'KG')),
      quantidade      INTEGER NOT NULL CHECK (quantidade > 0),
      preco_unitario  INTEGER NOT NULL CHECK (preco_unitario >= 0),
      total_bruto     INTEGER NOT NULL CHECK (total_bruto >= 0),
      desconto        INTEGER NOT NULL DEFAULT 0 CHECK (desconto >= 0 AND desconto <= total_bruto),
      total           INTEGER NOT NULL CHECK (total >= 0),
      cancelado       INTEGER NOT NULL DEFAULT 0 CHECK (cancelado IN (0, 1)),
      criado_em       TEXT NOT NULL DEFAULT ${AGORA},
      cancelado_em    TEXT,
      UNIQUE (venda_id, sequencia)
    ) STRICT;

    CREATE INDEX venda_itens_produto ON venda_itens (produto_id);

    -- Forma validada no código (a lista cresce: fiado chega na fase 5).
    CREATE TABLE venda_pagamentos (
      id         INTEGER PRIMARY KEY,
      venda_id   INTEGER NOT NULL REFERENCES vendas (id),
      forma      TEXT NOT NULL,
      valor      INTEGER NOT NULL CHECK (valor > 0),
      criado_em  TEXT NOT NULL DEFAULT ${AGORA}
    ) STRICT;

    CREATE INDEX venda_pagamentos_venda ON venda_pagamentos (venda_id);
  `
}
