import type { Migracao } from '../migracoes'

export const m008TabelaAPrazo: Migracao = {
  versao: 8,
  nome: 'tabela_a_prazo',
  sql: `
    -- Preço fixo do produto na tabela "A prazo" (opcional; sem ele vale o percentual da configuração).
    ALTER TABLE produtos ADD COLUMN preco_a_prazo INTEGER CHECK (preco_a_prazo > 0);

    -- Tabela de preço escolhida para cada item da venda (interna: não sai no cupom).
    ALTER TABLE venda_itens ADD COLUMN tabela_preco TEXT NOT NULL DEFAULT 'varejo'
      CHECK (tabela_preco IN ('varejo', 'a_prazo'));
  `
}
