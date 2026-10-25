import {
  CONFIG_BALANCA_PADRAO,
  CONFIG_IMPRESSORA_PADRAO,
  MODOS_IMPRESSORA,
  type ConfigBalancaSerial,
  type ConfigImpressora,
  type Diagramado,
  type Documento,
  type ResultadoHardware
} from '@shared/impressao'
import { obterCaixa } from '../caixa/caixa'
import type { Banco } from '../db/conexao'
import { ErroNegocio, exigirId } from '../erros'
import { definirConfig, obterConfig } from '../repos/configuracoes'
import { obterVenda } from '../vendas/vendas'
import { diagramar } from './diagramar'
import { bytesSoGaveta, gerarEscPos } from './escpos'
import { FORMAS_PAGAMENTO, type FormaPagamento } from '@shared/vendas'
import { obterCliente } from '../fiado/fiado'
import { obterConfigPix, payloadPix } from '../pix'
import {
  cobrancaPix,
  comprovanteCompraFiado,
  comprovanteMovimento,
  comprovanteRecebimentoFiado,
  cupomVenda,
  paginaTeste,
  relatorioFechamento,
  type ContextoLoja
} from './layouts'
import type { Transportes } from './transportes'

const BAUDS = [2400, 4800, 9600, 19200, 38400, 57600, 115200]

function lerJson<T extends object>(db: Banco, chave: string, padrao: T): T {
  try {
    const salvo = JSON.parse(obterConfig(db, chave) ?? '{}') as Partial<T>
    return { ...padrao, ...salvo }
  } catch {
    return { ...padrao }
  }
}

const texto = (v: unknown, max: number, campo: string): string => {
  if (typeof v !== 'string' || v.length > max) throw new ErroNegocio(`${campo} inválido`)
  return v.trim()
}

export function obterConfigImpressora(db: Banco): ConfigImpressora {
  return lerJson(db, 'impressora', CONFIG_IMPRESSORA_PADRAO)
}

export function salvarConfigImpressora(db: Banco, dado: unknown): ConfigImpressora {
  const d = { ...CONFIG_IMPRESSORA_PADRAO, ...((dado ?? {}) as Partial<ConfigImpressora>) }
  if (!Object.hasOwn(MODOS_IMPRESSORA, d.modo)) throw new ErroNegocio('Tipo de impressora inválido')
  const cfg: ConfigImpressora = {
    modo: d.modo,
    nome: texto(d.nome, 200, 'Nome da impressora'),
    host: texto(d.host, 100, 'Endereço da impressora'),
    porta: d.porta,
    serial: texto(d.serial, 50, 'Porta serial'),
    baud: d.baud,
    colunas: d.colunas,
    acentos: d.acentos,
    cortar: d.cortar === true,
    gaveta: d.gaveta,
    imprimirAutomatico: d.imprimirAutomatico === true,
    cabecalho: texto(d.cabecalho, 300, 'Cabeçalho'),
    rodape: texto(d.rodape, 200, 'Rodapé')
  }
  if (!Number.isInteger(cfg.porta) || cfg.porta < 1 || cfg.porta > 65535) throw new ErroNegocio('Porta TCP inválida')
  if (!BAUDS.includes(cfg.baud)) throw new ErroNegocio('Velocidade (baud) inválida')
  if (![32, 42, 48].includes(cfg.colunas)) throw new ErroNegocio('Colunas devem ser 32, 42 ou 48')
  if (!['cp850', 'cp860', 'sem'].includes(cfg.acentos)) throw new ErroNegocio('Tabela de caracteres inválida')
  if (!['nao', 'pino2', 'pino5'].includes(cfg.gaveta)) throw new ErroNegocio('Gaveta inválida')
  if ((cfg.modo === 'windows' || cfg.modo === 'driver') && !cfg.nome) throw new ErroNegocio('Escolha a impressora')
  if (cfg.modo === 'rede' && !cfg.host) throw new ErroNegocio('Informe o IP da impressora')
  if (cfg.modo === 'serial' && !cfg.serial) throw new ErroNegocio('Escolha a porta serial da impressora')
  if (cfg.cabecalho.split(/\r?\n/).length > 4) throw new ErroNegocio('Cabeçalho: no máximo 4 linhas')
  definirConfig(db, 'impressora', JSON.stringify(cfg))
  return cfg
}

export function obterConfigBalanca(db: Banco): ConfigBalancaSerial {
  return lerJson(db, 'balanca.serial', CONFIG_BALANCA_PADRAO)
}

export function salvarConfigBalanca(db: Banco, dado: unknown): ConfigBalancaSerial {
  const d = { ...CONFIG_BALANCA_PADRAO, ...((dado ?? {}) as Partial<ConfigBalancaSerial>) }
  if (d.modo !== 'nenhuma' && d.modo !== 'serial') throw new ErroNegocio('Leitura da balança inválida')
  if (![2400, 4800, 9600].includes(d.baud)) throw new ErroNegocio('Velocidade da balança inválida')
  const cfg: ConfigBalancaSerial = { modo: d.modo, porta: texto(d.porta, 50, 'Porta da balança'), baud: d.baud }
  if (cfg.modo === 'serial' && !cfg.porta) throw new ErroNegocio('Escolha a porta serial da balança')
  definirConfig(db, 'balanca.serial', JSON.stringify(cfg))
  return cfg
}

function contextoLoja(db: Banco, cfg: ConfigImpressora): ContextoLoja {
  return { nome: obterConfig(db, 'loja.nome') ?? 'Mercadinho', cabecalho: cfg.cabecalho, rodape: cfg.rodape }
}

/** Monta os documentos e entrega à impressora configurada. */
export class ServicoImpressao {
  constructor(
    private readonly db: Banco,
    private readonly transportes: Transportes
  ) {}

  private cfg(): ConfigImpressora {
    return obterConfigImpressora(this.db)
  }

  /**
   * Imprime os documentos em um só envio (cada um com seu corte). Lista vazia = só abrir a gaveta.
   */
  private async enviar(documentos: Documento[], { gaveta }: { gaveta: boolean }): Promise<void> {
    const cfg = this.cfg()
    if (cfg.modo === 'nenhuma') throw new ErroNegocio('Nenhuma impressora configurada (Configurações → Impressora)')

    if (cfg.modo === 'driver') {
      if (documentos.length === 0) throw new ErroNegocio('No modo "driver do Windows" a gaveta não abre pelo PDV')
      for (const d of documentos) await this.transportes.driver(cfg.nome, diagramar(d, cfg.colunas))
      return
    }

    const pino = gaveta && cfg.gaveta !== 'nao' ? cfg.gaveta : null
    if (documentos.length === 0 && !pino) throw new ErroNegocio('Gaveta não configurada (Configurações → Impressora)')
    const partes = documentos.map((d, i) =>
      gerarEscPos(diagramar(d, cfg.colunas), cfg, { abrirGaveta: i === 0 ? pino : null })
    )
    const bytes = partes.length ? Buffer.concat(partes) : bytesSoGaveta(pino!)

    if (cfg.modo === 'windows') return this.transportes.windows(cfg.nome, bytes)
    if (cfg.modo === 'rede') return this.transportes.rede(cfg.host, cfg.porta, bytes)
    return this.transportes.serial(cfg.serial, cfg.baud, bytes)
  }

  private documentoVenda(vendaId: unknown): Documento {
    const venda = obterVenda(this.db, exigirId(vendaId))
    if (!venda) throw new ErroNegocio('Venda não encontrada')
    const caixa = venda.caixaId !== null ? obterCaixa(this.db, venda.caixaId) : null
    return cupomVenda(venda, contextoLoja(this.db, this.cfg()), caixa)
  }

  /** Venda no fiado: via do estabelecimento para o cliente assinar. */
  private comprovanteFiado(vendaId: number): Documento | null {
    const venda = obterVenda(this.db, vendaId)
    if (!venda || venda.clienteId === null || !venda.pagamentos.some((p) => p.forma === 'fiado')) return null
    const cliente = obterCliente(this.db, venda.clienteId)
    return cliente ? comprovanteCompraFiado(venda, cliente, contextoLoja(this.db, this.cfg())) : null
  }

  imprimirVenda(vendaId: unknown): Promise<void> {
    return this.enviar([this.documentoVenda(vendaId)], { gaveta: false })
  }

  async imprimirRecebimentoFiado(lancamentoId: unknown): Promise<void> {
    const l = this.db
      .prepare(
        `SELECT l.valor, l.forma, l.criado_em, l.cliente_id, l.caixa_id, c.nome
         FROM fiado_lancamentos l JOIN clientes c ON c.id = l.cliente_id
         WHERE l.id = ? AND l.tipo = 'pagamento'`
      )
      .get(exigirId(lancamentoId)) as
      | { valor: number; forma: FormaPagamento; criado_em: string; cliente_id: number; caixa_id: number | null; nome: string }
      | undefined
    if (!l) throw new ErroNegocio('Recebimento não encontrado')
    const caixa = l.caixa_id !== null ? obterCaixa(this.db, l.caixa_id) : null
    const doc = comprovanteRecebimentoFiado(
      {
        cliente: l.nome,
        valor: l.valor,
        forma: FORMAS_PAGAMENTO[l.forma] ?? l.forma,
        saldo: obterCliente(this.db, l.cliente_id)?.saldo ?? 0,
        data: l.criado_em,
        caixa
      },
      contextoLoja(this.db, this.cfg())
    )
    await this.enviar([doc], { gaveta: l.forma === 'dinheiro' })
  }

  /**
   * Depois de finalizar: imprime o cupom (se automático) e abre a gaveta se entrou dinheiro.
   * Nunca lança: falha de hardware não pode travar o caixa, vira aviso na tela.
   */
  async aposVenda(vendaId: unknown): Promise<ResultadoHardware> {
    const cfg = this.cfg()
    try {
      const venda = obterVenda(this.db, exigirId(vendaId))
      if (!venda || venda.status !== 'finalizada') throw new ErroNegocio('Venda não finalizada')
      const imprimir = cfg.modo !== 'nenhuma' && cfg.imprimirAutomatico
      const gaveta =
        cfg.gaveta !== 'nao' &&
        cfg.modo !== 'nenhuma' &&
        cfg.modo !== 'driver' &&
        venda.pagamentos.some((p) => p.forma === 'dinheiro')
      // A via do fiado sai sempre que houver impressora: é a prova da dívida.
      const fiado = cfg.modo !== 'nenhuma' ? this.comprovanteFiado(venda.id) : null
      const documentos = [...(imprimir ? [this.documentoVenda(venda.id)] : []), ...(fiado ? [fiado] : [])]
      if (documentos.length === 0 && !gaveta) return { impresso: false, gaveta: false, erro: null }
      await this.enviar(documentos, { gaveta })
      return { impresso: documentos.length > 0, gaveta, erro: null }
    } catch (erro) {
      return { impresso: false, gaveta: false, erro: erro instanceof Error ? erro.message : String(erro) }
    }
  }

  /** QR do Pix em papel, para o cliente pagar pelo celular. */
  async imprimirPix(valor: unknown, vendaId: unknown): Promise<void> {
    const payload = payloadPix(this.db, valor, vendaId)
    if (!payload) throw new ErroNegocio('Configure a chave Pix em Configurações (F9)')
    const doc = cobrancaPix(
      { valor: valor as number, vendaId: typeof vendaId === 'number' ? vendaId : null, payload, chave: obterConfigPix(this.db).chave },
      contextoLoja(this.db, this.cfg())
    )
    await this.enviar([doc], { gaveta: false })
  }

  abrirGaveta(): Promise<void> {
    return this.enviar([], { gaveta: true })
  }

  imprimirTeste(): Promise<void> {
    const cfg = this.cfg()
    return this.enviar([paginaTeste(contextoLoja(this.db, cfg), cfg.colunas)], { gaveta: false })
  }

  /** Comprovante de sangria/suprimento; abre a gaveta para tirar/pôr o dinheiro. */
  async comprovanteMovimento(caixaId: unknown, movimentoId: unknown): Promise<void> {
    const caixa = obterCaixa(this.db, exigirId(caixaId))
    const movimento = caixa?.movimentos.find((m) => m.id === movimentoId)
    if (!caixa || !movimento) throw new ErroNegocio('Movimento de caixa não encontrado')
    await this.enviar([comprovanteMovimento(movimento, caixa, contextoLoja(this.db, this.cfg()))], { gaveta: true })
  }

  async imprimirFechamento(caixaId: unknown): Promise<void> {
    const caixa = obterCaixa(this.db, exigirId(caixaId))
    if (!caixa || caixa.status !== 'fechado') throw new ErroNegocio('Caixa não está fechado')
    await this.enviar([relatorioFechamento(caixa, contextoLoja(this.db, this.cfg()))], { gaveta: false })
  }

  /** Pré-visualização na tela, com a mesma diagramação da bobina. */
  previa(tipo: unknown, id: unknown): Diagramado {
    const cfg = this.cfg()
    const loja = contextoLoja(this.db, cfg)
    if (tipo === 'teste') return diagramar(paginaTeste(loja, cfg.colunas), cfg.colunas)
    if (tipo === 'venda') return diagramar(this.documentoVenda(id), cfg.colunas)
    if (tipo === 'fechamento') {
      const caixa = obterCaixa(this.db, exigirId(id))
      if (!caixa) throw new ErroNegocio('Caixa não encontrado')
      return diagramar(relatorioFechamento(caixa, loja), cfg.colunas)
    }
    throw new ErroNegocio('Documento desconhecido')
  }
}
