import type { Migracao } from '../migracoes'

const AGORA = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`

export const m002Produtos: Migracao = {
  versao: 2,
  nome: 'produtos',
  sql: `
    CREATE TABLE categorias (
      id   INTEGER PRIMARY KEY,
      nome TEXT NOT NULL UNIQUE COLLATE NOCASE
    ) STRICT;

    CREATE TABLE produtos (
      id                INTEGER PRIMARY KEY,
      ean               TEXT UNIQUE,
      codigo_balanca    INTEGER UNIQUE CHECK (codigo_balanca BETWEEN 1 AND 999999),
      descricao         TEXT NOT NULL,
      descricao_busca   TEXT NOT NULL,
      unidade           TEXT NOT NULL CHECK (unidade IN ('UN', 'KG')),
      preco_venda       INTEGER NOT NULL CHECK (preco_venda > 0),
      preco_custo       INTEGER CHECK (preco_custo >= 0),
      categoria_id      INTEGER REFERENCES categorias (id),
      estoque_atual     INTEGER NOT NULL DEFAULT 0,
      estoque_minimo    INTEGER NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0),
      ativo             INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
      criado_em         TEXT NOT NULL DEFAULT ${AGORA},
      atualizado_em     TEXT NOT NULL DEFAULT ${AGORA},
      preco_alterado_em TEXT NOT NULL DEFAULT ${AGORA}
    ) STRICT;

    CREATE INDEX produtos_descricao_busca ON produtos (descricao_busca);
    CREATE INDEX produtos_categoria ON produtos (categoria_id);

    INSERT INTO configuracoes (chave, valor) VALUES
      ('balanca.digitos_codigo', '4'),
      ('balanca.tipo_valor', 'preco');
  `
}
