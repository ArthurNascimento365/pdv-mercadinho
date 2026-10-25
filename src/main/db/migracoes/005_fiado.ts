import type { Migracao } from '../migracoes'

const AGORA = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`

export const m005Fiado: Migracao = {
  versao: 5,
  nome: 'fiado',
  sql: `
    CREATE TABLE clientes (
      id          INTEGER PRIMARY KEY,
      nome        TEXT NOT NULL,
      nome_busca  TEXT NOT NULL,
      telefone    TEXT,
      limite      INTEGER NOT NULL DEFAULT 0 CHECK (limite >= 0),
      dia_acerto  INTEGER CHECK (dia_acerto BETWEEN 1 AND 31),
      observacao  TEXT,
      ativo       INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
      criado_em   TEXT NOT NULL DEFAULT ${AGORA}
    ) STRICT;

    CREATE INDEX clientes_busca ON clientes (nome_busca);

    -- Caderneta: compra aumenta o saldo; pagamento e estorno (venda cancelada) diminuem.
    CREATE TABLE fiado_lancamentos (
      id          INTEGER PRIMARY KEY,
      cliente_id  INTEGER NOT NULL REFERENCES clientes (id),
      tipo        TEXT NOT NULL CHECK (tipo IN ('compra', 'pagamento', 'estorno')),
      valor       INTEGER NOT NULL CHECK (valor > 0),
      venda_id    INTEGER REFERENCES vendas (id),
      -- Pagamento entra no caixa aberto, na forma recebida.
      caixa_id    INTEGER REFERENCES caixas (id),
      forma       TEXT,
      -- Compra acima do limite ou com atraso, liberada com a senha do gerente.
      autorizado  INTEGER NOT NULL DEFAULT 0 CHECK (autorizado IN (0, 1)),
      criado_em   TEXT NOT NULL DEFAULT ${AGORA}
    ) STRICT;

    CREATE INDEX fiado_cliente ON fiado_lancamentos (cliente_id, id);
    CREATE INDEX fiado_caixa ON fiado_lancamentos (caixa_id);

    ALTER TABLE vendas ADD COLUMN cliente_id INTEGER REFERENCES clientes (id);
    ALTER TABLE vendas ADD COLUMN fiado_autorizado INTEGER NOT NULL DEFAULT 0;

    INSERT INTO configuracoes (chave, valor) VALUES ('fiado.dias_atraso', '30');
  `
}
