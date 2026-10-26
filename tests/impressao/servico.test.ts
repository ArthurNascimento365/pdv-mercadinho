import { createServer } from 'node:net'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ConfigImpressora, Diagramado } from '@shared/impressao'
import { abrirCaixa, fecharCaixa, movimentarCaixa } from '../../src/main/caixa/caixa'
import { abrirBanco, type Banco } from '../../src/main/db/conexao'
import { enviarRede } from '../../src/main/impressao/rede'
import {
  obterConfigImpressora,
  salvarConfigImpressora,
  ServicoImpressao
} from '../../src/main/impressao/servico'
import type { Transportes } from '../../src/main/impressao/transportes'
import { definirConfig } from '../../src/main/repos/configuracoes'
import { criarProduto } from '../../src/main/repos/produtos'
import { criarCliente } from '../../src/main/fiado/fiado'
import { adicionarPagamento, adicionarProduto, definirClienteVenda, finalizarVenda } from '../../src/main/vendas/vendas'
import { entrada } from '../ajuda'

type Envio = { via: string; destino: string; bytes?: Uint8Array; documento?: Diagramado }

function transportesFalsos(falhar = false): Transportes & { envios: Envio[] } {
  const envios: Envio[] = []
  const registrar = async (e: Envio): Promise<void> => {
    if (falhar) throw new Error('impressora sem papel')
    envios.push(e)
  }
  return {
    envios,
    windows: (nome, bytes) => registrar({ via: 'windows', destino: nome, bytes }),
    rede: (host, porta, bytes) => registrar({ via: 'rede', destino: `${host}:${porta}`, bytes }),
    serial: (caminho, baud, bytes) => registrar({ via: 'serial', destino: `${caminho}@${baud}`, bytes }),
    driver: (nome, documento) => registrar({ via: 'driver', destino: nome, documento })
  }
}

const texto = (b: Uint8Array) => Buffer.from(b).toString('latin1')
const temGaveta = (b: Uint8Array) => texto(b).includes('\x1bp')

describe('serviço de impressão', () => {
  let db: Banco
  let produtoId: number

  beforeEach(() => {
    db = abrirBanco(':memory:')
    definirConfig(db, 'loja.nome', 'Mercadinho do Zé')
    produtoId = criarProduto(db, entrada({ descricao: 'Leite Condensado', precoVenda: 749 })).id
    abrirCaixa(db, 'Maria', 10_000)
  })

  const configurar = (cfg: Partial<ConfigImpressora>) =>
    salvarConfigImpressora(db, { ...obterConfigImpressora(db), ...cfg })

  function vender(pagamentos: [Parameters<typeof adicionarPagamento>[1], number][]) {
    adicionarProduto(db, produtoId, 3000) // 22,47
    for (const [forma, valor] of pagamentos) adicionarPagamento(db, forma, valor)
    return finalizarVenda(db)
  }

  describe('configuração', () => {
    it('padrão: sem impressora', () => {
      expect(obterConfigImpressora(db).modo).toBe('nenhuma')
    })

    it.each([
      [{ modo: 'windows', nome: '' }, /Escolha a impressora/],
      [{ modo: 'rede', host: '' }, /IP/],
      [{ modo: 'serial', serial: '' }, /porta serial/],
      [{ colunas: 40 }, /Colunas/],
      [{ porta: 70_000 }, /Porta TCP/],
      [{ modo: 'laser' }, /Tipo de impressora/],
      [{ cabecalho: 'a\nb\nc\nd\ne' }, /4 linhas/]
    ])('recusa %j', (cfg, erro) => {
      expect(() => configurar(cfg as Partial<ConfigImpressora>)).toThrow(erro)
    })
  })

  describe('depois da venda', () => {
    it('sem impressora não faz nada e não dá erro', async () => {
      const t = transportesFalsos()
      const v = vender([['dinheiro', 5000]])
      expect(await new ServicoImpressao(db, t).aposVenda(v.id)).toEqual({ impresso: false, gaveta: false, erro: null })
      expect(t.envios).toEqual([])
    })

    it('dinheiro: imprime o cupom e abre a gaveta no mesmo envio', async () => {
      configurar({ modo: 'windows', nome: 'Elgin i9' })
      const t = transportesFalsos()
      const v = vender([['dinheiro', 5000]])
      expect(await new ServicoImpressao(db, t).aposVenda(v.id)).toEqual({ impresso: true, gaveta: true, erro: null })
      expect(t.envios).toHaveLength(1)
      const bytes = t.envios[0]!.bytes!
      expect(temGaveta(bytes)).toBe(true)
      const t1 = texto(bytes)
      expect(t1).toContain('Mercadinho do Z\x82') // é na CP850
      expect(t1).toContain('CUPOM N\xc7O FISCAL') // Ã na CP850
      expect(t1).toContain('3 un x 7,49')
      expect(t1).toContain('Troco')
    })

    it('cupom mostra "Total recebido" só com pagamento dividido ou troco', () => {
      const s = new ServicoImpressao(db, transportesFalsos())
      const linhas = (id: number) => s.previa('venda', id).linhas.map((l) => l.texto)
      const recebido = (id: number) => linhas(id).find((l) => l.startsWith('Total recebido'))

      const dividida = vender([['pix', 1000], ['dinheiro', 2000]]) // 22,47 → troco 7,53
      expect(recebido(dividida.id)).toMatch(/30,00$/)
      const l = linhas(dividida.id)
      expect(l.findIndex((x) => x.startsWith('Total recebido'))).toBe(l.findIndex((x) => x.startsWith('Troco')) - 1)

      expect(recebido(vender([['credito', 1000], ['credito', 1247]]).id)).toMatch(/22,47$/)
      expect(recebido(vender([['pix', 2247]]).id)).toBeUndefined()
    })

    it('Pix: imprime sem abrir a gaveta', async () => {
      configurar({ modo: 'rede', host: '192.168.0.50' })
      const t = transportesFalsos()
      const v = vender([['pix', 2247]])
      expect(await new ServicoImpressao(db, t).aposVenda(v.id)).toMatchObject({ impresso: true, gaveta: false })
      expect(t.envios[0]!.destino).toBe('192.168.0.50:9100')
      expect(temGaveta(t.envios[0]!.bytes!)).toBe(false)
    })

    it('impressão manual (F12): só abre a gaveta depois da venda', async () => {
      configurar({ modo: 'serial', serial: 'COM3', imprimirAutomatico: false })
      const t = transportesFalsos()
      const v = vender([['dinheiro', 3000]])
      expect(await new ServicoImpressao(db, t).aposVenda(v.id)).toMatchObject({ impresso: false, gaveta: true })
      expect(texto(t.envios[0]!.bytes!)).toBe('\x1b@\x1bp\x00\x19\xfa')
    })

    it('falha na impressora vira aviso, não exceção', async () => {
      configurar({ modo: 'windows', nome: 'Elgin i9' })
      const v = vender([['dinheiro', 5000]])
      const r = await new ServicoImpressao(db, transportesFalsos(true)).aposVenda(v.id)
      expect(r).toEqual({ impresso: false, gaveta: false, erro: 'impressora sem papel' })
    })

    it('modo driver: imprime pela página e nunca tenta a gaveta', async () => {
      configurar({ modo: 'driver', nome: 'Microsoft Print to PDF', colunas: 32 })
      const t = transportesFalsos()
      const v = vender([['dinheiro', 5000]])
      expect(await new ServicoImpressao(db, t).aposVenda(v.id)).toMatchObject({ impresso: true, gaveta: false })
      expect(t.envios[0]!.documento!.colunas).toBe(32)
      await expect(new ServicoImpressao(db, t).abrirGaveta()).rejects.toThrow(/gaveta não abre/)
    })
  })

  it('venda no fiado sai com a via de assinatura, mesmo sem impressão automática', async () => {
    configurar({ modo: 'windows', nome: 'x', imprimirAutomatico: false })
    const clienteId = criarCliente(db, { nome: 'João da Silva', telefone: null, limite: 10_000 }).id
    adicionarProduto(db, produtoId, 3000)
    definirClienteVenda(db, clienteId)
    adicionarPagamento(db, 'fiado', 2247)
    const v = finalizarVenda(db)
    const t = transportesFalsos()
    expect(await new ServicoImpressao(db, t).aposVenda(v.id)).toMatchObject({ impresso: true, gaveta: false })
    const s = texto(t.envios[0]!.bytes!)
    expect(s).not.toContain('CUPOM N') // o cupom é só no F12
    expect(s).toContain('COMPRA NO FIADO')
    expect(s).toContain('Cliente: Jo\xe3o da Silva'.replace('\xe3', '\xc6')) // ã na CP850
    expect(s).toContain('Saldo devedor agora')
  })

  it('cupom diagramado tem a largura exata da bobina', () => {
    configurar({ modo: 'windows', nome: 'x', colunas: 42 })
    const v = vender([['dinheiro', 5000]])
    const d = new ServicoImpressao(db, transportesFalsos()).previa('venda', v.id)
    expect(d.linhas.length).toBeGreaterThan(10)
    for (const l of d.linhas) expect(l.texto).toHaveLength(l.grande ? 21 : 42)
    expect(d.linhas.some((l) => l.grande && /^TOTAL\s+R\$ 22,47$/.test(l.texto))).toBe(true)
  })

  it('sangria imprime comprovante com assinatura e abre a gaveta', async () => {
    configurar({ modo: 'windows', nome: 'x' })
    const c = movimentarCaixa(db, 'sangria', 5000, 'cofre')
    const t = transportesFalsos()
    await new ServicoImpressao(db, t).comprovanteMovimento(c.id, c.movimentos[0]!.id)
    const s = texto(t.envios[0]!.bytes!)
    expect(temGaveta(t.envios[0]!.bytes!)).toBe(true)
    expect(s).toContain('SANGRIA DE CAIXA')
    expect(s).toContain('Motivo: cofre')
    expect(s).toContain('Assinatura')
  })

  it('relatório de fechamento só de caixa fechado', async () => {
    configurar({ modo: 'windows', nome: 'x' })
    const t = transportesFalsos()
    const servico = new ServicoImpressao(db, t)
    const caixaId = movimentarCaixa(db, 'suprimento', 1000, null).id
    await expect(servico.imprimirFechamento(caixaId)).rejects.toThrow(/não está fechado/)
    fecharCaixa(db, { dinheiro: 10_500, debito: 0, credito: 0, pix: 0 }, null)
    await servico.imprimirFechamento(caixaId)
    expect(texto(t.envios[0]!.bytes!)).toContain('FALTA')
  })

  it('sem impressora, abrir gaveta explica o que fazer', async () => {
    await expect(new ServicoImpressao(db, transportesFalsos()).abrirGaveta()).rejects.toThrow(/Nenhuma impressora/)
  })
})

describe('enviarRede', () => {
  it('entrega os bytes a um servidor TCP (como a impressora na porta 9100)', async () => {
    const recebido: Buffer[] = []
    const servidor = createServer((s) => s.on('data', (d) => recebido.push(Buffer.from(d))))
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r))
    const porta = (servidor.address() as { port: number }).port
    await enviarRede('127.0.0.1', porta, Uint8Array.from([0x1b, 0x40, 0x41]))
    await new Promise((r) => setTimeout(r, 20))
    servidor.close()
    expect(Buffer.concat(recebido)).toEqual(Buffer.from([0x1b, 0x40, 0x41]))
  })

  it('conexão recusada vira mensagem clara', async () => {
    const servidor = createServer()
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r))
    const porta = (servidor.address() as { port: number }).port
    await new Promise<void>((r) => servidor.close(() => r()))
    await expect(enviarRede('127.0.0.1', porta, Uint8Array.of(1), 2000)).rejects.toThrow(/recusou a conexão/)
  })
})
