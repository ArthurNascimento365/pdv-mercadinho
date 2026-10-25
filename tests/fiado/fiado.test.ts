import { beforeEach, describe, expect, it } from 'vitest'
import { linkWhatsApp } from '@shared/fiado'
import { abrirCaixa, caixaAberto, fecharCaixa } from '../../src/main/caixa/caixa'
import { abrirBanco, type Banco } from '../../src/main/db/conexao'
import {
  cobrancaCliente,
  comprasEmAberto,
  criarCliente,
  definirAtivoCliente,
  extratoCliente,
  obterCliente,
  receberFiado
} from '../../src/main/fiado/fiado'
import { definirConfig } from '../../src/main/repos/configuracoes'
import { criarProduto } from '../../src/main/repos/produtos'
import { conferirSenhaGerente, definirSenhaGerente } from '../../src/main/seguranca'
import {
  adicionarPagamento,
  adicionarProduto,
  cancelarVendaAberta,
  cancelarVendaFinalizada,
  definirClienteVenda,
  finalizarVenda,
  removerPagamento
} from '../../src/main/vendas/vendas'
import { entrada } from '../ajuda'

describe('fiado', () => {
  let db: Banco
  let produtoId: number // R$ 10,00
  let clienteId: number // limite R$ 50,00

  beforeEach(() => {
    db = abrirBanco(':memory:')
    abrirCaixa(db, 'Maria', 0)
    produtoId = criarProduto(db, entrada({ precoVenda: 1000 })).id
    clienteId = criarCliente(db, { nome: 'Dona Maria das Graças', telefone: '(11) 98765-4321', limite: 5000, diaAcerto: 10, observacao: null }).id
  })

  /** Venda de `unidades` × R$ 10 paga no fiado (e o resto em dinheiro). */
  function venderFiado(unidades: number, noFiado: number, senha: string | null = null) {
    adicionarProduto(db, produtoId, unidades * 1000)
    definirClienteVenda(db, clienteId)
    adicionarPagamento(db, 'fiado', noFiado, senha)
    if (noFiado < unidades * 1000) adicionarPagamento(db, 'dinheiro', unidades * 1000 - noFiado)
    return finalizarVenda(db)
  }

  /** Volta o relógio da caderneta (simula compra antiga). Uma hora a mais evita empate no limite do dia. */
  const envelhecer = (dias: number) =>
    db
      .prepare(`UPDATE fiado_lancamentos SET criado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?, '-1 hours')`)
      .run(`-${dias} days`)

  it('cadastro valida nome, telefone e limite', () => {
    expect(() => criarCliente(db, { nome: ' ', telefone: null, limite: 0 })).toThrow(/nome/)
    expect(() => criarCliente(db, { nome: 'Zé', telefone: '1234', limite: 0 })).toThrow(/DDD/)
    expect(() => criarCliente(db, { nome: 'Zé', telefone: null, limite: -1 })).toThrow(/Limite/)
    expect(obterCliente(db, clienteId)).toMatchObject({ telefone: '11987654321', saldo: 0, diasEmAberto: null })
  })

  it('fiado exige cliente na venda', () => {
    adicionarProduto(db, produtoId, 1000)
    expect(() => adicionarPagamento(db, 'fiado', 1000)).toThrow(/Identifique o cliente/)
  })

  it('fiado combinado com dinheiro; só a parte do fiado vai para a caderneta', () => {
    const v = venderFiado(3, 2000)
    expect(v.clienteNome).toBe('Dona Maria das Graças')
    expect(obterCliente(db, clienteId)!.saldo).toBe(2000)
    const c = caixaAberto(db)!
    expect(c.vendidoFiado).toBe(2000)
    expect(c.recebido.dinheiro).toBe(1000)
  })

  it('bloqueia acima do limite; sem senha cadastrada, explica como liberar', () => {
    venderFiado(4, 4000)
    adicionarProduto(db, produtoId, 2000)
    definirClienteVenda(db, clienteId)
    expect(() => adicionarPagamento(db, 'fiado', 2000)).toThrow(/Passa do limite.*Cadastre a senha do gerente/)
  })

  it('a senha do gerente libera a venda acima do limite e fica registrada', () => {
    definirSenhaGerente(db, '1234', null)
    venderFiado(4, 4000)
    adicionarProduto(db, produtoId, 2000)
    definirClienteVenda(db, clienteId)
    try {
      adicionarPagamento(db, 'fiado', 2000)
      expect.unreachable()
    } catch (e) {
      expect((e as { codigo: string }).codigo).toBe('gerente')
    }
    expect(() => adicionarPagamento(db, 'fiado', 2000, 'errada')).toThrow(/Senha do gerente incorreta/)
    adicionarPagamento(db, 'fiado', 2000, '1234')
    finalizarVenda(db)
    const ext = extratoCliente(db, clienteId)
    expect(ext.cliente.saldo).toBe(6000)
    expect(ext.lancamentos.map((l) => l.autorizado)).toEqual([false, true])
  })

  it('bloqueia quem tem compra em aberto há mais dias que o permitido', () => {
    definirConfig(db, 'fiado.dias_atraso', '30')
    venderFiado(1, 1000)
    envelhecer(31)
    expect(obterCliente(db, clienteId)!.diasEmAberto).toBe(31)
    adicionarProduto(db, produtoId, 1000)
    definirClienteVenda(db, clienteId)
    expect(() => adicionarPagamento(db, 'fiado', 1000)).toThrow(/em aberto há 31 dias/)
  })

  it('recebimento parcial quita as compras mais antigas primeiro e entra no caixa', () => {
    venderFiado(1, 1000)
    venderFiado(2, 2000)
    const { cliente } = receberFiado(db, clienteId, 1500, 'pix')
    expect(cliente.saldo).toBe(1500)
    expect(extratoCliente(db, clienteId).emAberto.map((c) => [c.valor, c.restante])).toEqual([[2000, 1500]])
    expect(caixaAberto(db)!.recebido.pix).toBe(1500)
    expect(caixaAberto(db)!.recebimentosFiado).toBe(1500)
    expect(() => receberFiado(db, clienteId, 1600, 'dinheiro')).toThrow(/maior que o saldo/)
  })

  it('pagamento de fiado em dinheiro entra no esperado do fechamento', () => {
    venderFiado(2, 2000)
    receberFiado(db, clienteId, 2000, 'dinheiro')
    const f = fecharCaixa(db, { dinheiro: 2000, debito: 0, credito: 0, pix: 0 }, null)
    expect(f.fechamento!.find((l) => l.forma === 'dinheiro')).toMatchObject({ esperado: 2000, diferenca: 0 })
    expect(f.fechamento!.map((l) => l.forma)).not.toContain('fiado')
  })

  it('receber exige caixa aberto', () => {
    venderFiado(1, 1000)
    fecharCaixa(db, { dinheiro: 0, debito: 0, credito: 0, pix: 0 }, null)
    expect(() => receberFiado(db, clienteId, 500, 'dinheiro')).toThrow(/caixa está fechado/)
  })

  it('cancelar a venda estorna o fiado', () => {
    const v = venderFiado(2, 2000)
    cancelarVendaFinalizada(db, v.id)
    const ext = extratoCliente(db, clienteId)
    expect(ext.cliente.saldo).toBe(0)
    expect(ext.emAberto).toEqual([])
    expect(ext.lancamentos.map((l) => [l.tipo, l.saldoApos])).toEqual([
      ['compra', 2000],
      ['estorno', 0]
    ])
  })

  it('não troca o cliente com fiado lançado; não inativa quem deve', () => {
    adicionarProduto(db, produtoId, 1000)
    definirClienteVenda(db, clienteId)
    const v = adicionarPagamento(db, 'fiado', 1000)
    expect(() => definirClienteVenda(db, null)).toThrow(/Remova o pagamento no fiado/)
    removerPagamento(db, v.pagamentos[0]!.id)
    definirClienteVenda(db, null)
    cancelarVendaAberta(db)
    venderFiado(1, 1000)
    expect(() => definirAtivoCliente(db, clienteId, false)).toThrow(/ainda deve/)
  })

  it('cobrança por WhatsApp com saldo, compras em aberto e chave Pix', () => {
    definirConfig(db, 'loja.nome', 'Mercadinho do Zé')
    definirConfig(db, 'pix', JSON.stringify({ chave: 'pix@mercadinho.com', nome: 'ZE', cidade: 'SAO PAULO' }))
    venderFiado(3, 3000)
    const c = cobrancaCliente(db, clienteId)
    expect(c.texto).toContain('Olá, Dona! Aqui é do Mercadinho do Zé.')
    expect(c.texto).toContain('R$ 30,00')
    expect(c.texto).toContain('Pix: pix@mercadinho.com')
    expect(c.link).toBe(`https://wa.me/5511987654321?text=${encodeURIComponent(c.texto)}`)
  })

  it('FIFO: estorno tira a compra; pagamento a mais vira crédito', () => {
    const l = (id: number, tipo: 'compra' | 'pagamento' | 'estorno', valor: number, venda_id: number | null = null) => ({
      id, tipo, valor, venda_id, forma: null, autorizado: 0, criado_em: `2026-10-0${id}T12:00:00Z`
    })
    expect(comprasEmAberto([l(1, 'compra', 100, 1), l(2, 'compra', 50, 2), l(3, 'estorno', 100, 1)])).toEqual([
      { vendaId: 2, data: '2026-10-02T12:00:00Z', valor: 50, restante: 50 }
    ])
    expect(comprasEmAberto([l(1, 'compra', 100, 1), l(2, 'pagamento', 150)])).toEqual([])
  })
})

describe('linkWhatsApp', () => {
  it.each([
    ['11987654321', 'https://wa.me/5511987654321?text=oi'],
    ['(11) 3333-4444', 'https://wa.me/551133334444?text=oi'],
    ['5511987654321', 'https://wa.me/5511987654321?text=oi'],
    ['123', null],
    [null, null]
  ])('%s', (tel, esperado) => {
    expect(linkWhatsApp(tel, 'oi')).toBe(esperado)
  })
})

describe('senha do gerente', () => {
  it('guarda só o hash e exige a atual para trocar', () => {
    const db = abrirBanco(':memory:')
    expect(() => definirSenhaGerente(db, '12', null)).toThrow(/4 caracteres/)
    definirSenhaGerente(db, 'segredo', null)
    expect(db.prepare(`SELECT valor FROM configuracoes WHERE chave = 'gerente.senha'`).get()).not.toMatchObject({ valor: 'segredo' })
    expect(conferirSenhaGerente(db, 'segredo')).toBe(true)
    expect(conferirSenhaGerente(db, 'Segredo')).toBe(false)
    expect(() => definirSenhaGerente(db, 'nova', 'errada')).toThrow(/atual/)
    definirSenhaGerente(db, 'nova', 'segredo')
    expect(conferirSenhaGerente(db, 'nova')).toBe(true)
  })
})
