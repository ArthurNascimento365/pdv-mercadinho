import { randomUUID } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, net } from 'electron'
import type { NotaFiscal } from '@shared/estoque'
import type { CanaisIpc, Canal, RespostaIpc } from '@shared/ipc'
import {
  listarBackups,
  obterConfigBackup,
  salvarConfigBackup,
  ultimoBackup,
  validarArquivo,
  type ServicoBackup
} from './backup/backup'
import { abrirCaixa, caixaAberto, fecharCaixa, listarCaixas, movimentarCaixa } from './caixa/caixa'
import { confirmarEntrada, listarEntradas, sugerirVinculos } from './entradas/entradas'
import { lerNfe } from './entradas/nfe'
import {
  definirDiasCobertura,
  diasCobertura,
  htmlListaCompras,
  listaCompras,
  pedidoWhatsApp
} from './estoque/compras'
import { alertasValidade, entradaManual, lotesEmEstoque } from './estoque/validade'
import { salvarPdf } from './impressao/pdf'
import {
  htmlEtiquetas,
  marcarEtiquetasImpressas,
  produtosParaEtiqueta,
  produtosPorIds,
  ultimaImpressaoEtiquetas
} from './promocoes/etiquetas'
import {
  atualizarCliente,
  buscarClientes,
  cobrancaCliente,
  criarCliente,
  definirAtivoCliente,
  extratoCliente,
  receberFiado
} from './fiado/fiado'
import { gerarPix, obterConfigPix, salvarConfigPix } from './pix'
import {
  curvaAbc,
  produtosSemGiro,
  relatorioFechamentos,
  relatorioFiado,
  relatorioMargem,
  relatorioVendas
} from './relatorios/relatorios'
import { definirSenhaGerente, temSenhaGerente } from './seguranca'
import { lerPeso } from './impressao/balanca'
import {
  obterConfigBalanca,
  obterConfigImpressora,
  salvarConfigBalanca,
  salvarConfigImpressora,
  type ServicoImpressao
} from './impressao/servico'
import { abrirCanalBalanca, listarPortasSerial } from './impressao/transportes'
import { movimentosDoProduto } from './repos/estoque'
import type { Banco } from './db/conexao'
import { versaoAtual } from './db/migracoes'
import { ErroNegocio, exigirId, exigirTexto } from './erros'
import { decodificarArquivo } from './importacao/csv'
import { analisarCsvProdutos, importarCsvProdutos, MODELO_CSV } from './importacao/produtosCsv'
import {
  definirConfig,
  definirFormatoBalanca,
  obterConfig,
  obterFormatoBalanca
} from './repos/configuracoes'
import {
  atualizarProduto,
  buscarProdutos,
  contarNoMinimo,
  criarProduto,
  definirAtivo,
  listarCategorias,
  obterProduto,
  produtosNoMinimo
} from './repos/produtos'
import { consultarEan } from './servicos/consultaEan'
import { resolverCodigo } from './servicos/leitorCodigo'
import { consultarOpenFoodFacts } from './servicos/openFoodFacts'
import {
  adicionarPagamento,
  adicionarPorCodigo,
  adicionarProduto,
  alterarQuantidade,
  cancelarItem,
  cancelarVendaAberta,
  cancelarVendaFinalizada,
  definirClienteVenda,
  descontoItem,
  descontoVenda,
  finalizarVenda,
  removerPagamento,
  ultimaVendaFinalizada,
  vendaAberta
} from './vendas/vendas'

type Retorno<K extends Canal> = CanaisIpc[K]['retorno']
type Handler<K extends Canal> = (...args: unknown[]) => Retorno<K> | Promise<Retorno<K>>

const TAMANHO_MAXIMO_CSV = 20 * 1024 * 1024
const TAMANHO_MAXIMO_XML = 5 * 1024 * 1024
const AMOSTRA_PREVIA = 50

function tratar<K extends Canal>(canal: K, handler: Handler<K>): void {
  ipcMain.handle(canal, async (_evento, ...args: unknown[]): Promise<RespostaIpc<Retorno<K>>> => {
    try {
      return { ok: true, valor: await handler(...args) }
    } catch (erro) {
      // O código vai como prefixo "[codigo] " (o contextBridge só preserva a mensagem do erro).
      if (erro instanceof ErroNegocio) {
        return { ok: false, erro: erro.codigo ? `[${erro.codigo}] ${erro.message}` : erro.message }
      }
      console.error(`[ipc] ${canal}`, erro)
      return { ok: false, erro: 'Erro interno. Tente de novo; se persistir, reinicie o PDV.' }
    }
  })
}

/** CSV para o Excel brasileiro: ";" e BOM UTF-8 (acentos certos ao abrir). */
function paraCsv(linhas: unknown[][]): string {
  const celula = (v: unknown): string => {
    const t = String(v ?? '')
    return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  return `﻿${linhas.map((l) => l.map(celula).join(';')).join('\r\n')}\r\n`
}

function janelaAtual(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

export interface ContextoIpc {
  db: Banco
  caminhoBanco: string
  impressao: ServicoImpressao
  backup: ServicoBackup
}

/** Argumentos vindos do renderer são `unknown`: valide tudo antes de usar. */
export function registrarIpc({ db, caminhoBanco, impressao, backup }: ContextoIpc): void {
  tratar('sistema:info', () => ({
    versaoApp: app.getVersion(),
    versaoSchema: versaoAtual(db),
    versaoSqlite: (db.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v,
    caminhoBanco
  }))

  tratar('config:obter', (chave) => obterConfig(db, exigirTexto(chave, 'chave', { max: 100 })))
  tratar('config:definir', (chave, valor) =>
    definirConfig(db, exigirTexto(chave, 'chave', { max: 100 }), exigirTexto(valor, 'valor'))
  )

  // Produtos
  tratar('produtos:buscar', (termo, incluirInativos) =>
    buscarProdutos(db, typeof termo === 'string' ? termo.slice(0, 200) : '', {
      incluirInativos: incluirInativos === true
    })
  )
  tratar('produtos:obter', (id) => obterProduto(db, exigirId(id)))
  tratar('produtos:criar', (entrada) => criarProduto(db, entrada))
  tratar('produtos:atualizar', (id, entrada) => atualizarProduto(db, exigirId(id), entrada))
  tratar('produtos:definirAtivo', (id, ativo) => definirAtivo(db, exigirId(id), ativo === true))
  tratar('produtos:consultarEan', (ean) =>
    consultarEan(db, exigirTexto(ean, 'EAN', { max: 20 }), (e) => consultarOpenFoodFacts(e, net.fetch))
  )
  tratar('produtos:resolverCodigo', (codigo) =>
    resolverCodigo(db, exigirTexto(codigo, 'código', { max: 30 }), obterFormatoBalanca(db))
  )
  tratar('categorias:listar', () => listarCategorias(db))

  // Balança
  tratar('balanca:obterFormato', () => obterFormatoBalanca(db))
  tratar('balanca:definirFormato', (formato) => definirFormatoBalanca(db, formato))

  // Frente de caixa
  tratar('vendas:atual', () => vendaAberta(db))
  tratar('vendas:adicionarCodigo', (codigo, quantidade) => {
    if (quantidade !== null && typeof quantidade !== 'number') throw new ErroNegocio('Quantidade inválida')
    return adicionarPorCodigo(db, exigirTexto(codigo, 'código', { max: 30 }), quantidade, obterFormatoBalanca(db))
  })
  tratar('vendas:adicionarProduto', (produtoId, quantidade) => adicionarProduto(db, produtoId, quantidade))
  tratar('vendas:alterarQuantidade', (itemId, quantidade) => alterarQuantidade(db, itemId, quantidade))
  tratar('vendas:descontoItem', (itemId, desconto) => descontoItem(db, itemId, desconto))
  tratar('vendas:descontoVenda', (desconto) => descontoVenda(db, desconto))
  tratar('vendas:cancelarItem', (itemId) => cancelarItem(db, itemId))
  tratar('vendas:cancelar', () => cancelarVendaAberta(db))
  tratar('vendas:adicionarPagamento', (forma, valor, senha) => adicionarPagamento(db, forma, valor, senha))
  tratar('vendas:definirCliente', (clienteId) => definirClienteVenda(db, clienteId))

  // Fiado
  tratar('fiado:buscar', (termo, inativos) =>
    buscarClientes(db, typeof termo === 'string' ? termo.slice(0, 100) : '', { incluirInativos: inativos === true })
  )
  tratar('fiado:criar', (entrada) => criarCliente(db, entrada))
  tratar('fiado:atualizar', (id, entrada) => atualizarCliente(db, id, entrada))
  tratar('fiado:definirAtivo', (id, ativo) => definirAtivoCliente(db, id, ativo))
  tratar('fiado:extrato', (id) => extratoCliente(db, id))
  tratar('fiado:receber', (id, valor, forma) => receberFiado(db, id, valor, forma))
  tratar('fiado:cobranca', (id) => cobrancaCliente(db, id))
  tratar('fiado:imprimirRecebimento', (lancamentoId) => impressao.imprimirRecebimentoFiado(lancamentoId))
  tratar('pix:obterConfig', () => obterConfigPix(db))
  tratar('pix:salvarConfig', (cfg) => salvarConfigPix(db, cfg))
  tratar('pix:gerar', (valor, vendaId) => gerarPix(db, valor, vendaId))
  tratar('pix:imprimir', (valor, vendaId) => impressao.imprimirPix(valor, vendaId))
  tratar('gerente:temSenha', () => temSenhaGerente(db))
  tratar('gerente:definirSenha', (nova, atual) => definirSenhaGerente(db, nova, atual))

  // Validade e lista de compras
  tratar('estoque:validade', () => lotesEmEstoque(db))
  tratar('estoque:alertasValidade', () => alertasValidade(db))
  tratar('estoque:entradaManual', (e) => entradaManual(db, e))
  const dias = (d: unknown): number => (typeof d === 'number' && Number.isInteger(d) && d > 0 && d <= 90 ? d : diasCobertura(db))
  tratar('compras:lista', (d) => listaCompras(db, dias(d)))
  tratar('compras:definirDias', (d) => definirDiasCobertura(db, d))
  tratar('compras:whatsapp', (fornecedorId, d) => {
    const grupo = listaCompras(db, dias(d)).grupos.find((g) => g.fornecedorId === (fornecedorId ?? null))
    if (!grupo) throw new ErroNegocio('Fornecedor sem itens na lista')
    return pedidoWhatsApp(db, grupo)
  })
  tratar('compras:pdf', async (d) => {
    const loja = obterConfig(db, 'loja.nome') ?? 'Mercadinho'
    const hoje = new Date().toISOString().slice(0, 10)
    const r = await salvarPdf(htmlListaCompras(listaCompras(db, dias(d)), loja), `lista-de-compras-${hoje}.pdf`, 'Salvar lista de compras')
    return r !== null
  })

  // Etiquetas de gôndola
  tratar('etiquetas:listar', (desde) => {
    const ultimaImpressao = ultimaImpressaoEtiquetas(db)
    // Primeira vez: o que mudou nos últimos 7 dias.
    const padrao = ultimaImpressao ?? new Date(Date.now() - 7 * 86_400_000).toISOString()
    return { ultimaImpressao, produtos: produtosParaEtiqueta(db, typeof desde === 'string' && desde ? desde : padrao) }
  })
  tratar('etiquetas:pdf', async (ids) => {
    const produtos = produtosPorIds(db, ids)
    const hoje = new Date().toISOString().slice(0, 10)
    const salvo = await salvarPdf(htmlEtiquetas(produtos), `etiquetas-gondola-${hoje}.pdf`, 'Salvar etiquetas de gôndola')
    if (salvo) marcarEtiquetasImpressas(db)
    return salvo !== null
  })

  // Relatórios
  tratar('relatorios:vendas', (p) => relatorioVendas(db, p))
  tratar('relatorios:fechamentos', (p) => relatorioFechamentos(db, p))
  tratar('relatorios:margem', (p) => relatorioMargem(db, p))
  tratar('relatorios:abc', (p) => curvaAbc(db, p))
  tratar('relatorios:fiado', () => relatorioFiado(db))
  tratar('relatorios:semGiro', (dias) => produtosSemGiro(db, dias))
  tratar('relatorios:exportarCsv', async (nome, linhas) => {
    if (!Array.isArray(linhas) || linhas.some((l) => !Array.isArray(l))) throw new ErroNegocio('Dados inválidos')
    const janela = janelaAtual()
    const opcoes = {
      title: 'Exportar relatório',
      defaultPath: `${typeof nome === 'string' ? nome.replace(/[^\w\- ]/g, '') : 'relatorio'}.csv`,
      filters: [{ name: 'Planilha CSV', extensions: ['csv'] }]
    }
    const r = janela ? await dialog.showSaveDialog(janela, opcoes) : await dialog.showSaveDialog(opcoes)
    if (r.canceled || !r.filePath) return false
    await writeFile(r.filePath, paraCsv(linhas as unknown[][]), 'utf8')
    return true
  })
  tratar('vendas:removerPagamento', (pagamentoId) => removerPagamento(db, pagamentoId))
  tratar('vendas:finalizar', () => finalizarVenda(db))
  tratar('vendas:ultimaFinalizada', () => ultimaVendaFinalizada(db))
  tratar('vendas:cancelarFinalizada', (vendaId) => cancelarVendaFinalizada(db, vendaId))

  // Caixa
  tratar('caixa:atual', () => caixaAberto(db))
  tratar('caixa:abrir', (operador, fundo) => abrirCaixa(db, operador, fundo))
  tratar('caixa:movimentar', (tipo, valor, motivo) => movimentarCaixa(db, tipo, valor, motivo))
  tratar('caixa:fechar', (contagem, observacao) => {
    const fechado = fecharCaixa(db, contagem, observacao)
    // Backup no fechamento (em segundo plano: o relatório aparece na hora).
    void backup.fazer('fechamento')
    return fechado
  })
  tratar('caixa:listar', () => listarCaixas(db))

  // Estoque
  tratar('estoque:noMinimo', () => produtosNoMinimo(db))
  tratar('estoque:contarNoMinimo', () => contarNoMinimo(db))
  tratar('estoque:movimentos', (produtoId) => movimentosDoProduto(db, exigirId(produtoId)))

  // Entrada por XML da NF-e: analisa → operador confere/vincula → confirma.
  let notaPendente: { id: string; nota: NotaFiscal } | null = null

  tratar('entradas:analisarXml', async () => {
    const janela = janelaAtual()
    const opcoes = {
      title: 'Entrada de mercadoria (XML da NF-e)',
      filters: [{ name: 'XML da NF-e', extensions: ['xml'] }],
      properties: ['openFile' as const]
    }
    const escolha = janela ? await dialog.showOpenDialog(janela, opcoes) : await dialog.showOpenDialog(opcoes)
    const caminho = escolha.filePaths[0]
    if (escolha.canceled || !caminho) return null

    if ((await stat(caminho)).size > TAMANHO_MAXIMO_XML) throw new ErroNegocio('Arquivo maior que 5 MB')
    const nota = lerNfe(await readFile(caminho, 'utf8'))
    const { fornecedorCadastrado, itens } = sugerirVinculos(db, nota)
    notaPendente = { id: randomUUID(), nota }
    return { id: notaPendente.id, arquivo: basename(caminho), nota, fornecedorCadastrado, itens }
  })

  tratar('entradas:confirmar', (id, decisoes) => {
    if (!notaPendente || notaPendente.id !== id) throw new ErroNegocio('A prévia expirou. Escolha o XML de novo.')
    const resultado = confirmarEntrada(db, notaPendente.nota, decisoes)
    notaPendente = null
    return resultado
  })

  tratar('entradas:listar', () => listarEntradas(db))

  // Backup
  tratar('backup:estado', () => ({
    config: obterConfigBackup(db),
    pastaPrincipal: backup.pastaPrincipal,
    ultimo: ultimoBackup(db),
    arquivos: listarBackups(backup.pastaPrincipal)
  }))
  tratar('backup:salvarConfig', (cfg) => salvarConfigBackup(db, cfg))
  tratar('backup:escolherPasta', async () => {
    const janela = janelaAtual()
    const opcoes = { title: 'Pasta para cópia do backup', properties: ['openDirectory' as const, 'createDirectory' as const] }
    const r = janela ? await dialog.showOpenDialog(janela, opcoes) : await dialog.showOpenDialog(opcoes)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  tratar('backup:fazer', () => backup.fazer('manual'))
  tratar('backup:validar', async (caminho) => {
    let alvo = typeof caminho === 'string' && caminho ? caminho : null
    if (!alvo) {
      const janela = janelaAtual()
      const opcoes = {
        title: 'Escolha o backup para restaurar',
        defaultPath: backup.pastaPrincipal,
        filters: [{ name: 'Backup do PDV', extensions: ['db'] }],
        properties: ['openFile' as const]
      }
      const r = janela ? await dialog.showOpenDialog(janela, opcoes) : await dialog.showOpenDialog(opcoes)
      if (r.canceled || !r.filePaths[0]) return null
      alvo = r.filePaths[0]
    }
    return validarArquivo(alvo)
  })
  tratar('backup:restaurar', (caminho) => backup.restaurar(exigirTexto(caminho, 'arquivo', { max: 1000 })))

  // Impressora, gaveta e balança
  tratar('hardware:obterConfig', () => ({ impressora: obterConfigImpressora(db), balanca: obterConfigBalanca(db) }))
  tratar('hardware:salvarImpressora', (cfg) => salvarConfigImpressora(db, cfg))
  tratar('hardware:salvarBalanca', (cfg) => salvarConfigBalanca(db, cfg))
  tratar('hardware:impressorasWindows', async () => {
    const janela = janelaAtual()
    if (!janela) return []
    return (await janela.webContents.getPrintersAsync()).map((p) => p.name)
  })
  tratar('hardware:portasSerial', () => listarPortasSerial())
  tratar('hardware:imprimirTeste', () => impressao.imprimirTeste())
  tratar('hardware:abrirGaveta', () => impressao.abrirGaveta())
  tratar('hardware:imprimirVenda', (vendaId) => impressao.imprimirVenda(vendaId))
  tratar('hardware:aposVenda', (vendaId) => impressao.aposVenda(vendaId))
  tratar('hardware:comprovanteMovimento', (caixaId, movimentoId) =>
    impressao.comprovanteMovimento(caixaId, movimentoId)
  )
  tratar('hardware:imprimirFechamento', (caixaId) => impressao.imprimirFechamento(caixaId))
  tratar('hardware:previa', (tipo, id) => impressao.previa(tipo, id))
  tratar('hardware:lerPeso', () => lerPeso(obterConfigBalanca(db), abrirCanalBalanca))

  // Importação CSV: analisa → mostra prévia → confirma. Guarda só a última prévia.
  let pendente: { id: string; texto: string } | null = null

  tratar('importacao:analisarCsv', async () => {
    const janela = janelaAtual()
    const opcoes = {
      title: 'Importar produtos (CSV)',
      filters: [{ name: 'Planilha CSV', extensions: ['csv', 'txt'] }],
      properties: ['openFile' as const]
    }
    const escolha = janela ? await dialog.showOpenDialog(janela, opcoes) : await dialog.showOpenDialog(opcoes)
    const caminho = escolha.filePaths[0]
    if (escolha.canceled || !caminho) return null

    if ((await stat(caminho)).size > TAMANHO_MAXIMO_CSV) throw new ErroNegocio('Arquivo maior que 20 MB')
    const texto = decodificarArquivo(await readFile(caminho))
    const analise = analisarCsvProdutos(db, texto)
    pendente = { id: randomUUID(), texto }
    return {
      id: pendente.id,
      arquivo: basename(caminho),
      totalLinhas: analise.totalLinhas,
      criar: analise.linhas.filter((l) => l.acao === 'criar').length,
      atualizar: analise.linhas.filter((l) => l.acao === 'atualizar').length,
      amostra: analise.linhas.slice(0, AMOSTRA_PREVIA),
      erros: analise.erros
    }
  })

  tratar('importacao:confirmarCsv', (id) => {
    if (!pendente || pendente.id !== id) throw new ErroNegocio('A prévia expirou. Escolha o arquivo de novo.')
    const resultado = importarCsvProdutos(db, pendente.texto)
    pendente = null
    return resultado
  })

  tratar('importacao:salvarModeloCsv', async () => {
    const janela = janelaAtual()
    const opcoes = {
      title: 'Salvar modelo de planilha',
      defaultPath: 'modelo-produtos.csv',
      filters: [{ name: 'Planilha CSV', extensions: ['csv'] }]
    }
    const escolha = janela ? await dialog.showSaveDialog(janela, opcoes) : await dialog.showSaveDialog(opcoes)
    if (escolha.canceled || !escolha.filePath) return false
    await writeFile(escolha.filePath, MODELO_CSV, 'utf8')
    return true
  })
}
