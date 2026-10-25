import type { Migracao } from '../migracoes'

const AGORA = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`

export const m006CustosLotes: Migracao = {
  versao: 6,
  nome: 'custos_lotes',
  sql: `
    -- Custo do item no momento da venda (base da margem). Itens antigos: o relatório usa o custo atual.
    ALTER TABLE venda_itens ADD COLUMN custo_unitario INTEGER;

    -- Lote recebido com validade (XML da NF-e com <rastro> ou entrada manual).
    CREATE TABLE lotes (
      id          INTEGER PRIMARY KEY,
      produto_id  INTEGER NOT NULL REFERENCES produtos (id),
      lote        TEXT,
      validade    TEXT NOT NULL,
      quantidade  INTEGER NOT NULL CHECK (quantidade > 0),
      entrada_id  INTEGER REFERENCES entradas (id),
      criado_em   TEXT NOT NULL DEFAULT ${AGORA}
    ) STRICT;

    CREATE INDEX lotes_produto ON lotes (produto_id, validade);

    INSERT INTO lotes (produto_id, lote, validade, quantidade, entrada_id, criado_em)
      SELECT i.produto_id, i.lote, i.validade, i.quantidade, i.entrada_id, e.criado_em
      FROM entrada_itens i JOIN entradas e ON e.id = i.entrada_id
      WHERE i.validade IS NOT NULL;

    INSERT INTO configuracoes (chave, valor) VALUES ('compras.dias_cobertura', '7');
  `
}
