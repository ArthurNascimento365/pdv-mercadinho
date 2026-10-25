import type { Migracao } from '../migracoes'

export const m007Promocoes: Migracao = {
  versao: 7,
  nome: 'promocoes',
  sql: `
    -- Promoção com data de início e fim (datas locais AAAA-MM-DD, inclusivas).
    ALTER TABLE produtos ADD COLUMN preco_promocional INTEGER CHECK (preco_promocional > 0);
    ALTER TABLE produtos ADD COLUMN promocao_inicio TEXT;
    ALTER TABLE produtos ADD COLUMN promocao_fim TEXT;
    -- Atacarejo: a partir de N (milésimos) na mesma venda, preço X.
    ALTER TABLE produtos ADD COLUMN atacado_quantidade INTEGER CHECK (atacado_quantidade > 0);
    ALTER TABLE produtos ADD COLUMN atacado_preco INTEGER CHECK (atacado_preco > 0);

    -- Preço de tabela (normal ou promoção) quando o item entrou; o atacado é recalculado em cima dele.
    ALTER TABLE venda_itens ADD COLUMN preco_tabela INTEGER;
    ALTER TABLE venda_itens ADD COLUMN tipo_preco TEXT NOT NULL DEFAULT 'normal'
      CHECK (tipo_preco IN ('normal', 'promocao', 'atacado', 'etiqueta'));
    UPDATE venda_itens SET preco_tabela = preco_unitario;
  `
}
