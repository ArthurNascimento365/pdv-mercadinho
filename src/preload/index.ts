import { contextBridge, ipcRenderer } from 'electron'
import type { CanaisIpc, Canal, PdvApi, RespostaIpc } from '@shared/ipc'

async function invocar<K extends Canal>(
  canal: K,
  ...args: CanaisIpc[K]['args']
): Promise<CanaisIpc[K]['retorno']> {
  const resposta = (await ipcRenderer.invoke(canal, ...args)) as RespostaIpc<CanaisIpc[K]['retorno']>
  if (!resposta.ok) throw new Error(resposta.erro)
  return resposta.valor
}

const api: PdvApi = {
  sistema: {
    info: () => invocar('sistema:info')
  },
  config: {
    obter: (chave) => invocar('config:obter', chave),
    definir: (chave, valor) => invocar('config:definir', chave, valor)
  },
  produtos: {
    buscar: (termo, incluirInativos = false) => invocar('produtos:buscar', termo, incluirInativos),
    obter: (id) => invocar('produtos:obter', id),
    criar: (entrada) => invocar('produtos:criar', entrada),
    atualizar: (id, entrada) => invocar('produtos:atualizar', id, entrada),
    definirAtivo: (id, ativo) => invocar('produtos:definirAtivo', id, ativo),
    consultarEan: (ean) => invocar('produtos:consultarEan', ean),
    resolverCodigo: (codigo) => invocar('produtos:resolverCodigo', codigo),
    categorias: () => invocar('categorias:listar')
  },
  balanca: {
    obterFormato: () => invocar('balanca:obterFormato'),
    definirFormato: (formato) => invocar('balanca:definirFormato', formato)
  },
  importacao: {
    analisarCsv: () => invocar('importacao:analisarCsv'),
    confirmarCsv: (id) => invocar('importacao:confirmarCsv', id),
    salvarModeloCsv: () => invocar('importacao:salvarModeloCsv')
  },
  vendas: {
    atual: () => invocar('vendas:atual'),
    adicionarCodigo: (codigo, quantidade) => invocar('vendas:adicionarCodigo', codigo, quantidade),
    adicionarProduto: (produtoId, quantidade) => invocar('vendas:adicionarProduto', produtoId, quantidade),
    alterarQuantidade: (itemId, quantidade) => invocar('vendas:alterarQuantidade', itemId, quantidade),
    descontoItem: (itemId, desconto) => invocar('vendas:descontoItem', itemId, desconto),
    descontoVenda: (desconto) => invocar('vendas:descontoVenda', desconto),
    cancelarItem: (itemId) => invocar('vendas:cancelarItem', itemId),
    cancelar: () => invocar('vendas:cancelar'),
    adicionarPagamento: (forma, valor, senhaGerente = null) =>
      invocar('vendas:adicionarPagamento', forma, valor, senhaGerente),
    definirCliente: (clienteId) => invocar('vendas:definirCliente', clienteId),
    removerPagamento: (pagamentoId) => invocar('vendas:removerPagamento', pagamentoId),
    finalizar: () => invocar('vendas:finalizar'),
    ultimaFinalizada: () => invocar('vendas:ultimaFinalizada'),
    cancelarFinalizada: (vendaId) => invocar('vendas:cancelarFinalizada', vendaId)
  },
  caixa: {
    atual: () => invocar('caixa:atual'),
    abrir: (operador, fundoTroco) => invocar('caixa:abrir', operador, fundoTroco),
    movimentar: (tipo, valor, motivo) => invocar('caixa:movimentar', tipo, valor, motivo),
    fechar: (contagem, observacao) => invocar('caixa:fechar', contagem, observacao),
    listar: () => invocar('caixa:listar')
  },
  estoque: {
    noMinimo: () => invocar('estoque:noMinimo'),
    contarNoMinimo: () => invocar('estoque:contarNoMinimo'),
    movimentos: (produtoId) => invocar('estoque:movimentos', produtoId)
  },
  entradas: {
    analisarXml: () => invocar('entradas:analisarXml'),
    confirmar: (id, decisoes) => invocar('entradas:confirmar', id, decisoes),
    listar: () => invocar('entradas:listar')
  },
  hardware: {
    obterConfig: () => invocar('hardware:obterConfig'),
    salvarImpressora: (cfg) => invocar('hardware:salvarImpressora', cfg),
    salvarBalanca: (cfg) => invocar('hardware:salvarBalanca', cfg),
    impressorasWindows: () => invocar('hardware:impressorasWindows'),
    portasSerial: () => invocar('hardware:portasSerial'),
    imprimirTeste: () => invocar('hardware:imprimirTeste'),
    abrirGaveta: () => invocar('hardware:abrirGaveta'),
    imprimirVenda: (vendaId) => invocar('hardware:imprimirVenda', vendaId),
    aposVenda: (vendaId) => invocar('hardware:aposVenda', vendaId),
    comprovanteMovimento: (caixaId, movimentoId) => invocar('hardware:comprovanteMovimento', caixaId, movimentoId),
    imprimirFechamento: (caixaId) => invocar('hardware:imprimirFechamento', caixaId),
    previa: (tipo, id = null) => invocar('hardware:previa', tipo, id),
    lerPeso: () => invocar('hardware:lerPeso')
  },
  backup: {
    estado: () => invocar('backup:estado'),
    salvarConfig: (cfg) => invocar('backup:salvarConfig', cfg),
    escolherPasta: () => invocar('backup:escolherPasta'),
    fazer: () => invocar('backup:fazer'),
    validar: (caminho = null) => invocar('backup:validar', caminho),
    restaurar: (caminho) => invocar('backup:restaurar', caminho)
  },
  fiado: {
    buscar: (termo, incluirInativos = false) => invocar('fiado:buscar', termo, incluirInativos),
    criar: (entrada) => invocar('fiado:criar', entrada),
    atualizar: (id, entrada) => invocar('fiado:atualizar', id, entrada),
    definirAtivo: (id, ativo) => invocar('fiado:definirAtivo', id, ativo),
    extrato: (id) => invocar('fiado:extrato', id),
    receber: (id, valor, forma) => invocar('fiado:receber', id, valor, forma),
    cobranca: (id) => invocar('fiado:cobranca', id),
    imprimirRecebimento: (lancamentoId) => invocar('fiado:imprimirRecebimento', lancamentoId)
  },
  pix: {
    obterConfig: () => invocar('pix:obterConfig'),
    salvarConfig: (cfg) => invocar('pix:salvarConfig', cfg),
    gerar: (valor, vendaId) => invocar('pix:gerar', valor, vendaId),
    imprimir: (valor, vendaId) => invocar('pix:imprimir', valor, vendaId)
  },
  gerente: {
    temSenha: () => invocar('gerente:temSenha'),
    definirSenha: (nova, atual) => invocar('gerente:definirSenha', nova, atual)
  },
  validade: {
    lotes: () => invocar('estoque:validade'),
    alertas: () => invocar('estoque:alertasValidade'),
    entradaManual: (entrada) => invocar('estoque:entradaManual', entrada)
  },
  compras: {
    lista: (dias) => invocar('compras:lista', dias),
    definirDias: (dias) => invocar('compras:definirDias', dias),
    whatsapp: (fornecedorId, dias) => invocar('compras:whatsapp', fornecedorId, dias),
    pdf: (dias) => invocar('compras:pdf', dias)
  },
  etiquetas: {
    listar: (desde) => invocar('etiquetas:listar', desde),
    pdf: (produtoIds) => invocar('etiquetas:pdf', produtoIds)
  },
  relatorios: {
    vendas: (periodo) => invocar('relatorios:vendas', periodo),
    fechamentos: (periodo) => invocar('relatorios:fechamentos', periodo),
    margem: (periodo) => invocar('relatorios:margem', periodo),
    abc: (periodo) => invocar('relatorios:abc', periodo),
    fiado: () => invocar('relatorios:fiado'),
    semGiro: (dias) => invocar('relatorios:semGiro', dias),
    exportarCsv: (nome, linhas) => invocar('relatorios:exportarCsv', nome, linhas)
  }
}

contextBridge.exposeInMainWorld('pdv', api)
