# PDV Mercadinho

PDV desktop para mercadinho: venda 100% offline, cupom não fiscal.
Roadmap e especificação dos diferenciais: doc "PDV Mercadinho — Roadmap MVP e Diferenciais"
(https://claude.ai/artifact/M4nBv2G4Nz6dUZS8yi7Uip).

## Estado do projeto (atualizado em 25/10/2026)

### Concluído — MVP completo (fases 0 a 5 do roadmap)

- **Fase 0 — Fundação:** Electron + React + TS + `node:sqlite`, migrações, IPC tipado, testes.
- **Fase 1 — Produtos:** cadastro, busca, EAN (local → Open Facts → manual), etiquetas de
  balança (formato configurável), importação CSV com prévia.
- **Fase 2 — Frente de caixa:** venda só pelo teclado, desconto item/venda, cancelamentos,
  pagamentos combinados, troco, venda retomada após queda.
- **Fase 3 — Caixa, estoque e entrada:** abertura, sangria/suprimento, fechamento cego,
  entrada por XML da NF-e (aprende o código do fornecedor), histórico de estoque, estoque mínimo.
- **Fase 4 — Hardware:** cupom ESC/POS (Windows RAW, rede, serial, driver), gaveta, balança
  serial (protocolo Toledo), prévia/reimpressão do cupom.
- **Fase 5 — Diferenciais:** backup automático com rotação e restauração; fiado com limite,
  senha do gerente e cobrança por WhatsApp; Pix com QR estático; relatórios (vendas,
  fechamentos, margem, ABC, fiado, sem giro, exportação CSV); validade por lote (FEFO
  estimado); lista de compras (PDF/WhatsApp); promoções, atacarejo e etiquetas de gôndola A4.
- **Pós-MVP (19/10):** consulta de EAN com `product_type=all` (alimentos + higiene/cosméticos
  + pet + limpeza nas bases Open Facts).
- Instalador `dist/PDV Mercadinho Setup 0.1.0.exe` gerado em 19/10/2026 já com o
  `product_type=all`. Schema do banco na versão 7. 289 testes passando (29 arquivos).

### Em andamento

- Nada sendo implementado. O próximo marco é o teste piloto na loja (ver Pendências).
- **Decisão aberta do usuário:** carregar a NF-e bipando o código de barras do DANFE (chave de
  44 dígitos). Opções apresentadas: (b) achar o XML com aquela chave numa pasta configurável
  (sem certificado) e/ou (a) baixar da SEFAZ pela Distribuição DF-e com o e-CNPJ A1 da loja,
  fazendo a ciência da operação. Não implementar antes de o usuário escolher.

### Decisões tomadas (e por quê)

- `node:sqlite` em vez de `better-sqlite3`: sem binário para o Electron 44 e sem Visual
  Studio na máquina. Pelo mesmo motivo, só dependências sem compilação (`serialport` N-API).
- Impressão RAW no Windows por PowerShell + winspool (Add-Type), sem módulo nativo; protocolo
  em base64 para não depender da página de código do console.
- Categoria sugerida pelo Open Food Facts foi descartada (vem em inglês e não bate com as
  categorias da loja).
- Fechamento de caixa cego; venda de caixa já fechado não se cancela.
- Validade: o caixa não escolhe lote; FEFO é só estimativa nos relatórios/alertas.
- Fiado: limite 0 = só com a senha do gerente; senha guardada como scrypt.
- **Pré-cadastro / catálogo offline de produtos: descartado pelo usuário em 25/10/2026.**
  Motivo levantado: as bases Open Facts têm ~37 mil itens brasileiros de alimentos, mas só
  ~900 de higiene, limpeza e pet. Não retomar sem pedido.
- Cosmos (Bluesoft) e GS1 Brasil (CNP) não foram integrados: planos do Cosmos não
  confirmados; a API da GS1 exige contrato e conta no CNP.

### Pendências (não testado ou incompleto)

- **Hardware real nunca testado:** impressora térmica, gaveta e balança serial só foram
  testadas com simulações (servidor TCP no lugar da impressora, COM1 sem nada ligado).
- **NF-e real de fornecedor não testada:** só a fixture `tests/fixtures/nfe-exemplo.xml`.
- Restauração de backup testada só nos testes unitários, não no app (ela reinicia o programa).
- Medidas da folha de etiquetas (Pimaco A4256, 63,5 × 38,1 mm) não conferidas em impressão.
- Instalador sem assinatura digital (aviso do SmartScreen), com o ícone padrão do Electron, e
  versão ainda 0.1.0 (não dá para distinguir instalações antigas das novas pelo número).
- Senha do gerente só é pedida no fiado; cancelamento e desconto continuam livres.
- Backup principal fica no mesmo disco do PDV; na loja, configurar pendrive e pasta da nuvem.
- Servidores do Open Food Facts tiveram timeouts intermitentes nos testes (o PDV já cai para
  o cadastro manual).
- Sem controle de versão (git não instalado); projeto dentro do OneDrive, que sincroniza
  `node_modules`.

### Próximos passos sugeridos

1. Piloto na loja: imprimir a página de teste (acentos e colunas), testar a gaveta (pino 2/5),
   ler o peso da balança e importar uma NF-e real de fornecedor.
2. Obter a decisão do usuário sobre a NF-e pelo DANFE (pasta de XMLs e/ou SEFAZ com A1).
3. Na próxima distribuição: ícone próprio (logo da loja) e versão 0.1.1.
4. Instalar git e tirar o projeto do OneDrive (ou excluir `node_modules` da sincronização).
5. Pós-MVP do roadmap: sincronização com a nuvem, retaguarda no celular, Cosmos opcional, NFC-e.

## Stack

- Electron 44 + electron-vite 6 + React 19 + TypeScript 5.9
- SQLite pelo **`node:sqlite`** embutido no Electron (Node 24). Não use `better-sqlite3`:
  não há binário pré-compilado para esta versão do Electron e a máquina não tem Visual Studio
  para compilar. O `node:sqlite` também já traz `backup()` (exigido pelo backup automático).
- Vitest para testes (roda no Node do sistema, que também tem `node:sqlite`).
- Dependências de runtime além do React (versões fixas): `fast-xml-parser` (NF-e),
  `serialport` (balança/impressora serial; binário N-API pré-compilado, vale para qualquer
  Electron — por isso `npmRebuild: false` no electron-builder.yml) e `qrcode` (QR do Pix).

## Comandos

- `npm run dev` — abre o app com hot reload
- `npm test` — testes (`npm run test:watch` para modo contínuo)
- `npm run typecheck` — confere os tipos do main e do renderer
- `npm run build` — typecheck + build em `out/`
- `npm run dist` — instalador Windows (NSIS) em `dist/`

## Estrutura

- `src/main/` — processo principal: banco, regras de negócio, IPC
  - `db/conexao.ts` abre o banco (WAL, foreign keys) e roda as migrações
  - `db/migracoes.ts` + `db/migracoes/NNN_nome.ts` — versão guardada em `PRAGMA user_version`
  - `db/transacao.ts` — `emTransacao(db, fn)`; aninhamento vira SAVEPOINT
  - `repos/` — acesso a dados, uma função por operação, recebendo `db` como 1º argumento
    (`produtos.ts` também valida a entrada: `validarProdutoEntrada`)
  - `servicos/` — consulta EAN (local → bases Open Facts com `product_type=all`: alimentos,
    beleza, pet e produtos; o servidor redireciona para a base certa → manual) e `resolverCodigo`,
    que traduz o que o leitor bipou (EAN ou etiqueta de balança) — base da frente de caixa
  - `vendas/vendas.ts` — frente de caixa: itens, descontos, cancelamentos, pagamentos, finalização
  - `caixa/caixa.ts` — turno do caixa: abertura, sangria/suprimento, fechamento cego
  - `repos/estoque.ts` — `movimentarEstoque`: única porta para mudar estoque (saldo + histórico)
  - `entradas/` — `nfe.ts` lê o XML da NF-e (fast-xml-parser, tudo como texto);
    `entradas.ts` sugere vínculos e dá entrada
  - `importacao/` — CSV de produtos: decodifica (UTF-8 ou Windows-1252), analisa sem gravar
    (prévia) e importa tudo-ou-nada
  - `impressao/` — cupom e hardware:
    `layouts.ts` (documentos: cupom, sangria, fechamento, teste) → `diagramar.ts` (linhas com a
    largura da bobina; a pré-visualização na tela usa o mesmo resultado) → `escpos.ts` (bytes,
    tabelas CP850/CP860, gaveta). `servico.ts` escolhe o transporte pela configuração;
    `transportes.ts` tem os reais (Windows RAW via PowerShell + winspool, rede TCP em `rede.ts`,
    serial, driver do Windows). `balanca.ts`: protocolo Toledo (ENQ → STX peso ETX).
  - `backup/backup.ts` — `ServicoBackup`: API de backup do SQLite (banco em uso), valida a
    cópia, replica nas pastas extras, rotação 7 diários + 4 semanais, restauração com reinício
  - `fiado/fiado.ts` — clientes, caderneta (compra/pagamento/estorno), FIFO das compras em
    aberto, limite/atraso, cobrança por WhatsApp. `seguranca.ts`: senha do gerente (scrypt)
  - `pix.ts` + `shared/pix.ts` — BR Code estático (EMV + CRC16) e QR (lib `qrcode`)
  - `relatorios/` — vendas, fechamentos, margem (desconto da venda rateado, custo do momento
    da venda), curva ABC, fiado em aberto, sem giro
  - `estoque/validade.ts` (lotes, FEFO estimado, alertas), `estoque/compras.ts` (lista de compras)
  - `promocoes/etiquetas.ts` — etiquetas de gôndola A4 (código de barras em `shared/codigoBarras.ts`);
    PDFs saem por `impressao/pdf.ts` (janela oculta + printToPDF)
  - `ipc.ts` — handlers; todo argumento do renderer chega como `unknown` e é validado
- `src/preload/` — expõe `window.pdv` (tipo `PdvApi`) via `contextBridge`
- `src/renderer/` — UI React; telas em `src/renderer/src/telas/`, atalhos com `useTeclas`
- `src/shared/` — código usado pelos dois lados (contrato IPC, dinheiro, EAN, balança, tipos)
- `tests/` — espelha `src/`

## Regras do projeto

- **Dinheiro é inteiro em centavos; quantidade é inteiro em milésimos** (1 un = 1000,
  0,350 kg = 350). Use `src/shared/dinheiro.ts`. Nunca float para dinheiro.
- Nomes do domínio em português (produto, venda, caixa, fiado); termos de framework em inglês.
- Migrações: nunca edite uma já distribuída. Crie a próxima com a versão seguinte e registre em
  `MIGRACOES`. Tabelas novas usam `STRICT`. Datas em texto ISO 8601 UTC.
- Novo canal IPC: `src/shared/ipc.ts` (CanaisIpc + PdvApi) → `src/main/ipc.ts` → `src/preload/index.ts`.
- Erro que o operador deve ver: lance `ErroNegocio` (src/main/erros.ts). Os outros viram
  "Erro interno" e vão para o log.
- Renderer não acessa Node nem o banco: `contextIsolation` + `sandbox` ligados.
- Tudo operável só pelo teclado: F2–F9 na tela inicial, Esc volta, F10 salva,
  Enter num formulário pula para o próximo campo.
- Produto nunca é apagado, só inativado (vendas antigas apontam para ele).
- EAN precisa ter dígito verificador válido. Etiqueta de balança: EAN-13 com prefixo 2,
  formato (dígitos do código 4/5/6, preço ou peso) em `configuracoes` (`balanca.*`).
  EAN cadastrado tem prioridade sobre a leitura como etiqueta.
- Vendas: gravadas desde o primeiro item (status `aberta`, no máximo uma — índice parcial),
  então uma queda do PDV não perde a venda. O item guarda descrição e preço do momento.
  Item e venda cancelados ficam registrados, nunca apagados. Estoque baixa só ao finalizar e
  volta ao cancelar uma venda finalizada. Só dinheiro pode passar do restante (gera troco);
  cartão/Pix são no valor exato, revalidados na finalização. Desconto da venda é limitado
  ao subtotal (reduz sozinho se itens forem cancelados).
- Caixa (tela Vender): Enter lança o código; `3*código` multiplica; PLU de até 6 dígitos
  digitado à mão pede o peso; F2 busca, F5/F6 desconto item/venda, F7/F8 cancela item/venda,
  F9 cancela a última venda finalizada, F10 pagamento (F1–F4 escolhe a forma).
- Caixa: só se vende com caixa aberto (um por vez). A venda guarda `caixa_id`. Dinheiro
  esperado = fundo + dinheiro das vendas (menos troco) + suprimentos − sangrias. Fechamento é
  cego (contagem de todas as formas antes de ver o esperado) e grava esperado × contado em
  `caixa_fechamento`. Não fecha com venda aberta; venda de caixa fechado não se cancela.
- Estoque: nunca faça UPDATE direto em `estoque_atual`; use `movimentarEstoque` (tipos:
  inicial, ajuste, venda, cancelamento_venda, entrada). "No mínimo" = mínimo > 0 e atual ≤ mínimo
  (`noEstoqueMinimo` / `produtosNoMinimo`).
- Entrada NF-e: casa item por vínculo (fornecedor + cProd) → cEAN → cEANTrib (fator =
  qTrib/qCom). Quantidade da nota em décimos de milésimo (4 casas). Custo do item = vProd −
  vDesc + frete + seguro + outras + IPI + ICMS-ST; custo unitário substitui `preco_custo`.
  Mesma chave não entra duas vezes. Lote/validade do `<rastro>` ficam em `entrada_itens`.
  Testes usam `tests/fixtures/nfe-exemplo.xml`.
- Hardware nunca trava o caixa: `aposVenda` devolve o erro em vez de lançar e a tela só avisa.
  Gaveta abre junto com o cupom quando entrou dinheiro (e na sangria/suprimento, F8 no Caixa).
  F11 mostra e F12 reimprime o último cupom. Configuração em `configuracoes` como JSON:
  `impressora` e `balanca.serial`. Testes usam transportes falsos; o smoke usa um servidor TCP
  local no lugar da impressora de rede.
- Backup: automático a cada `intervaloHoras` (padrão 4) e no fechamento de caixa; arquivos
  `pdv-AAAA-MM-DD_HHMMSS.db`. Pasta extra ausente (pendrive) não derruba o backup. Restaurar
  guarda antes um "antes-de-restaurar" e reinicia o app.
- Fiado: forma de pagamento "fiado" exige cliente na venda (F3); limite 0 = só com gerente.
  Bloqueio (limite/atraso > `fiado.dias_atraso`) vem como `ErroNegocio(..., 'gerente')`; o IPC
  manda o erro com prefixo `[gerente] ` e o renderer usa `exigeGerente(e)` para pedir a senha.
  Fiado não entra na contagem do fechamento (`FORMAS_CONTAVEIS`); pagamento de fiado entra no
  caixa aberto na forma recebida. Cancelar venda finalizada gera estorno na caderneta.
- Pix: QR estático gerado no PDV (txid `PDV<venda>`), confirmação manual pelo operador.
- Promoção/atacarejo: preço de tabela = promocional dentro das datas; atacarejo pela quantidade
  total do produto na venda (reprecifica todas as linhas, inclusive ao cancelar item). Etiqueta
  de balança mantém o total impresso. Mudança de preço/promoção/atacado atualiza
  `preco_alterado_em` (base das etiquetas de gôndola).
- Importação CSV não sobrescreve estoque de produto existente; estoque muda por entrada
  de mercadoria/ajuste (Fase 3). `preco_alterado_em` alimenta as etiquetas de gôndola (Fase 5).
- Toda regra de negócio nova ganha teste com banco `:memory:`.

## Ambiente

- Windows 11, PowerShell 5.1, Node 24. Sem git instalado.
- O projeto fica dentro do OneDrive; o banco do app fica em `%APPDATA%/pdv-mercadinho/dados/pdv.db`.
