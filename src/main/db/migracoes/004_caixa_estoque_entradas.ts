import type { Migracao } from '../migracoes'

const AGORA = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`

export const m004CaixaEstoqueEntradas: Migracao = {
  versao: 4,
  nome: 'caixa_estoque_entradas',
  sql: `
    -- Caixa (turno do operador)
    CREATE TABLE caixas (
      id           INTEGER PRIMARY KEY,
      status       TEXT NOT NULL CHECK (status IN ('aberto', 'fechado')),
      operador     TEXT NOT NULL,
      fundo_troco  INTEGER NOT NULL CHECK (fundo_troco >= 0),
      aberto_em    TEXT NOT NULL DEFAULT ${AGORA},
      fechado_em   TEXT,
      observacao   TEXT
    ) STRICT;

    CREATE UNIQUE INDEX caixas_um_aberto ON caixas (status) WHERE status = 'aberto';

    CREATE TABLE caixa_movimentos (
      id         INTEGER PRIMARY KEY,
      caixa_id   INTEGER NOT NULL REFERENCES caixas (id),
      tipo       TEXT NOT NULL CHECK (tipo IN ('sangria', 'suprimento')),
      valor      INTEGER NOT NULL CHECK (valor > 0),
      motivo     TEXT,
      criado_em  TEXT NOT NULL DEFAULT ${AGORA}
    ) STRICT;

    CREATE INDEX caixa_movimentos_caixa ON caixa_movimentos (caixa_id);

    -- Esperado × contado por forma de pagamento, gravado no fechamento.
    CREATE TABLE caixa_fechamento (
      caixa_id  INTEGER NOT NULL REFERENCES caixas (id),
      forma     TEXT NOT NULL,
      esperado  INTEGER NOT NULL,
      contado   INTEGER NOT NULL CHECK (contado >= 0),
      PRIMARY KEY (caixa_id, forma)
    ) STRICT;

    -- Caixa em que a venda foi finalizada.
    ALTER TABLE vendas ADD COLUMN caixa_id INTEGER REFERENCES caixas (id);
    CREATE INDEX vendas_caixa ON vendas (caixa_id);

    -- Fornecedores e entrada de mercadoria (NF-e)
    CREATE TABLE fornecedores (
      id             INTEGER PRIMARY KEY,
      cnpj           TEXT NOT NULL UNIQUE,
      razao_social   TEXT NOT NULL,
      nome_fantasia  TEXT,
      telefone       TEXT,
      criado_em      TEXT NOT NULL DEFAULT ${AGORA}
    ) STRICT;

    -- Vínculo "código do fornecedor → produto", aprendido na primeira entrada.
    -- fator: quantas unidades de venda há em 1 unidade da nota (ex.: CX com 12 → 12).
    CREATE TABLE produto_fornecedor (
      fornecedor_id  INTEGER NOT NULL REFERENCES fornecedores (id),
      codigo         TEXT NOT NULL,
      produto_id     INTEGER NOT NULL REFERENCES produtos (id),
      fator          REAL NOT NULL CHECK (fator > 0),
      ultimo_custo   INTEGER,
      atualizado_em  TEXT NOT NULL DEFAULT ${AGORA},
      PRIMARY KEY (fornecedor_id, codigo)
    ) STRICT;

    CREATE INDEX produto_fornecedor_produto ON produto_fornecedor (produto_id);

    CREATE TABLE entradas (
      id             INTEGER PRIMARY KEY,
      fornecedor_id  INTEGER NOT NULL REFERENCES fornecedores (id),
      chave          TEXT UNIQUE,
      numero         INTEGER,
      serie          INTEGER,
      emissao        TEXT,
      valor_total    INTEGER NOT NULL,
      criado_em      TEXT NOT NULL DEFAULT ${AGORA}
    ) STRICT;

    CREATE TABLE entrada_itens (
      id                 INTEGER PRIMARY KEY,
      entrada_id         INTEGER NOT NULL REFERENCES entradas (id),
      numero_item        INTEGER NOT NULL,
      produto_id         INTEGER NOT NULL REFERENCES produtos (id),
      codigo_fornecedor  TEXT,
      descricao_nota     TEXT NOT NULL,
      quantidade         INTEGER NOT NULL CHECK (quantidade > 0),
      custo_unitario     INTEGER NOT NULL CHECK (custo_unitario >= 0),
      custo_total        INTEGER NOT NULL CHECK (custo_total >= 0),
      -- Grupo <rastro> da NF-e, quando vem (base do controle de validade da fase 5).
      lote               TEXT,
      validade           TEXT
    ) STRICT;

    CREATE INDEX entrada_itens_produto ON entrada_itens (produto_id);

    -- Histórico de estoque. produtos.estoque_atual é o saldo, mantido junto com cada movimento.
    CREATE TABLE movimentos_estoque (
      id          INTEGER PRIMARY KEY,
      produto_id  INTEGER NOT NULL REFERENCES produtos (id),
      tipo        TEXT NOT NULL CHECK (tipo IN ('inicial', 'ajuste', 'venda', 'cancelamento_venda', 'entrada')),
      quantidade  INTEGER NOT NULL CHECK (quantidade <> 0),
      saldo       INTEGER NOT NULL,
      venda_id    INTEGER REFERENCES vendas (id),
      entrada_id  INTEGER REFERENCES entradas (id),
      criado_em   TEXT NOT NULL DEFAULT ${AGORA}
    ) STRICT;

    CREATE INDEX movimentos_estoque_produto ON movimentos_estoque (produto_id, criado_em);

    -- Saldo que já existia vira o movimento inicial, para o histórico fechar com o estoque.
    INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, saldo)
      SELECT id, 'inicial', estoque_atual, estoque_atual FROM produtos WHERE estoque_atual <> 0;
  `
}
