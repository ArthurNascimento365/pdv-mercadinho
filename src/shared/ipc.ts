/**
 * Contrato único entre main e renderer. Para expor algo novo:
 * 1. adicione o canal aqui;  2. registre o handler em src/main/ipc.ts;
 * 3. exponha em src/preload/index.ts.  O TypeScript cobra as três pontas.
 */
import type { FormatoBalanca } from './balanca'
import type {
  Categoria,
  CodigoResolvido,
  PreviaImportacao,
  Produto,
  ProdutoEntrada,
  ResultadoConsultaEan,
  ResultadoImportacao
} from './produtos'
import type { Centavos, Milesimos } from './dinheiro'
import type { FormaPagamento, ResultadoAdicionar, Venda } from './vendas'
import type { Contagem, ResumoCaixa } from './caixa'
import type {
  AlertasValidade,
  DecisaoItem,
  EntradaManual,
  ListaCompras,
  LoteEmEstoque,
  MovimentoEstoque,
  PreviaEntrada,
  ResumoEntrada
} from './estoque'
import type {
  ConfigBalancaSerial,
  ConfigImpressora,
  Diagramado,
  LeituraBalanca,
  PortaSerialInfo,
  ResultadoHardware
} from './impressao'

import type { ConfigBackup, EstadoBackup, InfoBackupValido, ResultadoBackup } from './backup'
import type { Cliente, ClienteEntrada, Cobranca, ExtratoCliente } from './fiado'
import type { ConfigPix } from './pix'
import type {
  LinhaAbc,
  LinhaFechamentoRelatorio,
  LinhaSemGiro,
  Periodo,
  RelatorioFiado,
  RelatorioMargem,
  RelatorioVendas
} from './relatorios'

export type TipoPrevia = 'teste' | 'venda' | 'fechamento'

export interface InfoSistema {
  versaoApp: string
  versaoSchema: number
  versaoSqlite: string
  caminhoBanco: string
}

export interface CanaisIpc {
  'sistema:info': { args: []; retorno: InfoSistema }
  'config:obter': { args: [chave: string]; retorno: string | null }
  'config:definir': { args: [chave: string, valor: string]; retorno: void }

  'produtos:buscar': { args: [termo: string, incluirInativos: boolean]; retorno: Produto[] }
  'produtos:obter': { args: [id: number]; retorno: Produto | null }
  'produtos:criar': { args: [entrada: ProdutoEntrada]; retorno: Produto }
  'produtos:atualizar': { args: [id: number, entrada: ProdutoEntrada]; retorno: Produto }
  'produtos:definirAtivo': { args: [id: number, ativo: boolean]; retorno: void }
  'produtos:consultarEan': { args: [ean: string]; retorno: ResultadoConsultaEan }
  'produtos:resolverCodigo': { args: [codigo: string]; retorno: CodigoResolvido | null }
  'categorias:listar': { args: []; retorno: Categoria[] }

  'balanca:obterFormato': { args: []; retorno: FormatoBalanca }
  'balanca:definirFormato': { args: [formato: FormatoBalanca]; retorno: void }

  'importacao:analisarCsv': { args: []; retorno: PreviaImportacao | null }
  'importacao:confirmarCsv': { args: [id: string]; retorno: ResultadoImportacao }
  'importacao:salvarModeloCsv': { args: []; retorno: boolean }

  'vendas:atual': { args: []; retorno: Venda | null }
  'vendas:adicionarCodigo': { args: [codigo: string, quantidade: Milesimos | null]; retorno: ResultadoAdicionar }
  'vendas:adicionarProduto': { args: [produtoId: number, quantidade: Milesimos]; retorno: Venda }
  'vendas:descontoItem': { args: [itemId: number, desconto: Centavos]; retorno: Venda }
  'vendas:descontoVenda': { args: [desconto: Centavos]; retorno: Venda }
  'vendas:cancelarItem': { args: [itemId: number]; retorno: Venda }
  'vendas:cancelar': { args: []; retorno: void }
  'vendas:adicionarPagamento': {
    args: [forma: FormaPagamento, valor: Centavos, senhaGerente: string | null]
    retorno: Venda
  }
  'vendas:definirCliente': { args: [clienteId: number | null]; retorno: Venda }
  'vendas:removerPagamento': { args: [pagamentoId: number]; retorno: Venda }
  'vendas:finalizar': { args: []; retorno: Venda }
  'vendas:ultimaFinalizada': { args: []; retorno: Venda | null }
  'vendas:cancelarFinalizada': { args: [vendaId: number]; retorno: Venda }

  'caixa:atual': { args: []; retorno: ResumoCaixa | null }
  'caixa:abrir': { args: [operador: string, fundoTroco: Centavos]; retorno: ResumoCaixa }
  'caixa:movimentar': {
    args: [tipo: 'sangria' | 'suprimento', valor: Centavos, motivo: string | null]
    retorno: ResumoCaixa
  }
  'caixa:fechar': { args: [contagem: Contagem, observacao: string | null]; retorno: ResumoCaixa }
  'caixa:listar': { args: []; retorno: ResumoCaixa[] }

  'estoque:noMinimo': { args: []; retorno: Produto[] }
  'estoque:contarNoMinimo': { args: []; retorno: number }
  'estoque:movimentos': { args: [produtoId: number]; retorno: MovimentoEstoque[] }

  'entradas:analisarXml': { args: []; retorno: PreviaEntrada | null }
  'entradas:confirmar': { args: [id: string, decisoes: DecisaoItem[]]; retorno: ResumoEntrada }
  'entradas:listar': { args: []; retorno: ResumoEntrada[] }

  'hardware:obterConfig': { args: []; retorno: { impressora: ConfigImpressora; balanca: ConfigBalancaSerial } }
  'hardware:salvarImpressora': { args: [cfg: ConfigImpressora]; retorno: ConfigImpressora }
  'hardware:salvarBalanca': { args: [cfg: ConfigBalancaSerial]; retorno: ConfigBalancaSerial }
  'hardware:impressorasWindows': { args: []; retorno: string[] }
  'hardware:portasSerial': { args: []; retorno: PortaSerialInfo[] }
  'hardware:imprimirTeste': { args: []; retorno: void }
  'hardware:abrirGaveta': { args: []; retorno: void }
  'hardware:imprimirVenda': { args: [vendaId: number]; retorno: void }
  'hardware:aposVenda': { args: [vendaId: number]; retorno: ResultadoHardware }
  'hardware:comprovanteMovimento': { args: [caixaId: number, movimentoId: number]; retorno: void }
  'hardware:imprimirFechamento': { args: [caixaId: number]; retorno: void }
  'hardware:previa': { args: [tipo: TipoPrevia, id: number | null]; retorno: Diagramado }
  'hardware:lerPeso': { args: []; retorno: LeituraBalanca }

  'backup:estado': { args: []; retorno: EstadoBackup }
  'backup:salvarConfig': { args: [cfg: ConfigBackup]; retorno: ConfigBackup }
  'backup:escolherPasta': { args: []; retorno: string | null }
  'backup:fazer': { args: []; retorno: ResultadoBackup }
  'backup:validar': { args: [caminho: string | null]; retorno: InfoBackupValido | null }
  'backup:restaurar': { args: [caminho: string]; retorno: void }

  'fiado:buscar': { args: [termo: string, incluirInativos: boolean]; retorno: Cliente[] }
  'fiado:criar': { args: [entrada: ClienteEntrada]; retorno: Cliente }
  'fiado:atualizar': { args: [id: number, entrada: ClienteEntrada]; retorno: Cliente }
  'fiado:definirAtivo': { args: [id: number, ativo: boolean]; retorno: Cliente }
  'fiado:extrato': { args: [id: number]; retorno: ExtratoCliente }
  'fiado:receber': {
    args: [id: number, valor: Centavos, forma: FormaPagamento]
    retorno: { lancamentoId: number; cliente: Cliente }
  }
  'fiado:cobranca': { args: [id: number]; retorno: Cobranca }
  'fiado:imprimirRecebimento': { args: [lancamentoId: number]; retorno: void }

  'pix:obterConfig': { args: []; retorno: ConfigPix }
  'pix:salvarConfig': { args: [cfg: ConfigPix]; retorno: ConfigPix }
  'pix:gerar': { args: [valor: Centavos, vendaId: number | null]; retorno: { payload: string; svg: string } | null }
  'pix:imprimir': { args: [valor: Centavos, vendaId: number | null]; retorno: void }

  'gerente:temSenha': { args: []; retorno: boolean }
  'gerente:definirSenha': { args: [nova: string, atual: string | null]; retorno: void }

  'estoque:validade': { args: []; retorno: LoteEmEstoque[] }
  'estoque:alertasValidade': { args: []; retorno: AlertasValidade }
  'estoque:entradaManual': { args: [entrada: EntradaManual]; retorno: void }
  'compras:lista': { args: [dias: number | null]; retorno: ListaCompras }
  'compras:definirDias': { args: [dias: number]; retorno: void }
  'compras:whatsapp': { args: [fornecedorId: number | null, dias: number]; retorno: { texto: string; link: string } }
  'compras:pdf': { args: [dias: number]; retorno: boolean }

  'etiquetas:listar': { args: [desde: string | null]; retorno: { ultimaImpressao: string | null; produtos: Produto[] } }
  'etiquetas:pdf': { args: [produtoIds: number[]]; retorno: boolean }

  'relatorios:vendas': { args: [periodo: Periodo]; retorno: RelatorioVendas }
  'relatorios:fechamentos': { args: [periodo: Periodo]; retorno: LinhaFechamentoRelatorio[] }
  'relatorios:margem': { args: [periodo: Periodo]; retorno: RelatorioMargem }
  'relatorios:abc': { args: [periodo: Periodo]; retorno: LinhaAbc[] }
  'relatorios:fiado': { args: []; retorno: RelatorioFiado }
  'relatorios:semGiro': { args: [dias: number]; retorno: LinhaSemGiro[] }
  'relatorios:exportarCsv': { args: [nome: string, linhas: string[][]]; retorno: boolean }
}

export type Canal = keyof CanaisIpc

/** Formato de toda resposta IPC: erros de regra de negócio chegam ao renderer como mensagem. */
export type RespostaIpc<T> = { ok: true; valor: T } | { ok: false; erro: string }

export interface PdvApi {
  sistema: {
    info(): Promise<InfoSistema>
  }
  config: {
    obter(chave: string): Promise<string | null>
    definir(chave: string, valor: string): Promise<void>
  }
  produtos: {
    buscar(termo: string, incluirInativos?: boolean): Promise<Produto[]>
    obter(id: number): Promise<Produto | null>
    criar(entrada: ProdutoEntrada): Promise<Produto>
    atualizar(id: number, entrada: ProdutoEntrada): Promise<Produto>
    definirAtivo(id: number, ativo: boolean): Promise<void>
    consultarEan(ean: string): Promise<ResultadoConsultaEan>
    resolverCodigo(codigo: string): Promise<CodigoResolvido | null>
    categorias(): Promise<Categoria[]>
  }
  balanca: {
    obterFormato(): Promise<FormatoBalanca>
    definirFormato(formato: FormatoBalanca): Promise<void>
  }
  importacao: {
    /** Abre o seletor de arquivo; null se o operador cancelou. */
    analisarCsv(): Promise<PreviaImportacao | null>
    confirmarCsv(id: string): Promise<ResultadoImportacao>
    /** Abre "Salvar como"; false se cancelou. */
    salvarModeloCsv(): Promise<boolean>
  }
  vendas: {
    /** Venda em andamento (inclusive a que sobrou de uma queda do PDV). */
    atual(): Promise<Venda | null>
    adicionarCodigo(codigo: string, quantidade: Milesimos | null): Promise<ResultadoAdicionar>
    adicionarProduto(produtoId: number, quantidade: Milesimos): Promise<Venda>
    descontoItem(itemId: number, desconto: Centavos): Promise<Venda>
    descontoVenda(desconto: Centavos): Promise<Venda>
    cancelarItem(itemId: number): Promise<Venda>
    cancelar(): Promise<void>
    adicionarPagamento(forma: FormaPagamento, valor: Centavos, senhaGerente?: string | null): Promise<Venda>
    definirCliente(clienteId: number | null): Promise<Venda>
    removerPagamento(pagamentoId: number): Promise<Venda>
    finalizar(): Promise<Venda>
    ultimaFinalizada(): Promise<Venda | null>
    cancelarFinalizada(vendaId: number): Promise<Venda>
  }
  caixa: {
    atual(): Promise<ResumoCaixa | null>
    abrir(operador: string, fundoTroco: Centavos): Promise<ResumoCaixa>
    movimentar(tipo: 'sangria' | 'suprimento', valor: Centavos, motivo: string | null): Promise<ResumoCaixa>
    fechar(contagem: Contagem, observacao: string | null): Promise<ResumoCaixa>
    listar(): Promise<ResumoCaixa[]>
  }
  estoque: {
    noMinimo(): Promise<Produto[]>
    contarNoMinimo(): Promise<number>
    movimentos(produtoId: number): Promise<MovimentoEstoque[]>
  }
  entradas: {
    /** Abre o seletor de arquivo; null se o operador cancelou. */
    analisarXml(): Promise<PreviaEntrada | null>
    confirmar(id: string, decisoes: DecisaoItem[]): Promise<ResumoEntrada>
    listar(): Promise<ResumoEntrada[]>
  }
  hardware: {
    obterConfig(): Promise<{ impressora: ConfigImpressora; balanca: ConfigBalancaSerial }>
    salvarImpressora(cfg: ConfigImpressora): Promise<ConfigImpressora>
    salvarBalanca(cfg: ConfigBalancaSerial): Promise<ConfigBalancaSerial>
    impressorasWindows(): Promise<string[]>
    portasSerial(): Promise<PortaSerialInfo[]>
    imprimirTeste(): Promise<void>
    abrirGaveta(): Promise<void>
    imprimirVenda(vendaId: number): Promise<void>
    /** Cupom automático + gaveta (se entrou dinheiro). Nunca rejeita: erro vem no resultado. */
    aposVenda(vendaId: number): Promise<ResultadoHardware>
    comprovanteMovimento(caixaId: number, movimentoId: number): Promise<void>
    imprimirFechamento(caixaId: number): Promise<void>
    previa(tipo: TipoPrevia, id?: number | null): Promise<Diagramado>
    lerPeso(): Promise<LeituraBalanca>
  }
  backup: {
    estado(): Promise<EstadoBackup>
    salvarConfig(cfg: ConfigBackup): Promise<ConfigBackup>
    escolherPasta(): Promise<string | null>
    fazer(): Promise<ResultadoBackup>
    /** Sem caminho, abre o seletor de arquivo (null se cancelou). */
    validar(caminho?: string | null): Promise<InfoBackupValido | null>
    /** Troca o banco e reinicia o PDV. */
    restaurar(caminho: string): Promise<void>
  }
  fiado: {
    buscar(termo: string, incluirInativos?: boolean): Promise<Cliente[]>
    criar(entrada: ClienteEntrada): Promise<Cliente>
    atualizar(id: number, entrada: ClienteEntrada): Promise<Cliente>
    definirAtivo(id: number, ativo: boolean): Promise<Cliente>
    extrato(id: number): Promise<ExtratoCliente>
    receber(id: number, valor: Centavos, forma: FormaPagamento): Promise<{ lancamentoId: number; cliente: Cliente }>
    cobranca(id: number): Promise<Cobranca>
    imprimirRecebimento(lancamentoId: number): Promise<void>
  }
  pix: {
    obterConfig(): Promise<ConfigPix>
    salvarConfig(cfg: ConfigPix): Promise<ConfigPix>
    /** QR com o valor; null se o Pix não estiver configurado. */
    gerar(valor: Centavos, vendaId: number | null): Promise<{ payload: string; svg: string } | null>
    imprimir(valor: Centavos, vendaId: number | null): Promise<void>
  }
  gerente: {
    temSenha(): Promise<boolean>
    definirSenha(nova: string, atual: string | null): Promise<void>
  }
  validade: {
    lotes(): Promise<LoteEmEstoque[]>
    alertas(): Promise<AlertasValidade>
    entradaManual(entrada: EntradaManual): Promise<void>
  }
  compras: {
    /** null = dias de cobertura salvos. */
    lista(dias: number | null): Promise<ListaCompras>
    definirDias(dias: number): Promise<void>
    whatsapp(fornecedorId: number | null, dias: number): Promise<{ texto: string; link: string }>
    /** Gera o PDF, pergunta onde salvar e abre; false se cancelou. */
    pdf(dias: number): Promise<boolean>
  }
  etiquetas: {
    /** Produtos com preço/promoção alterados desde a data (null = desde a última impressão). */
    listar(desde: string | null): Promise<{ ultimaImpressao: string | null; produtos: Produto[] }>
    /** Gera o PDF A4, pergunta onde salvar, abre e marca como impresso; false se cancelou. */
    pdf(produtoIds: number[]): Promise<boolean>
  }
  relatorios: {
    vendas(periodo: Periodo): Promise<RelatorioVendas>
    fechamentos(periodo: Periodo): Promise<LinhaFechamentoRelatorio[]>
    margem(periodo: Periodo): Promise<RelatorioMargem>
    abc(periodo: Periodo): Promise<LinhaAbc[]>
    fiado(): Promise<RelatorioFiado>
    semGiro(dias: number): Promise<LinhaSemGiro[]>
    /** Abre "Salvar como"; false se cancelou. Primeira linha = cabeçalho. */
    exportarCsv(nome: string, linhas: string[][]): Promise<boolean>
  }
}
