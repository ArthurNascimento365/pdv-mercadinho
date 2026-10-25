import { beforeEach, describe, expect, it } from 'vitest'
import { abrirCaixa } from '../../src/main/caixa/caixa'
import { abrirBanco, type Banco } from '../../src/main/db/conexao'
import { confirmarEntrada } from '../../src/main/entradas/entradas'
import { lerNfe } from '../../src/main/entradas/nfe'
import { listaCompras, pedidoWhatsApp, textoQuantidade } from '../../src/main/estoque/compras'
import { criarProduto } from '../../src/main/repos/produtos'
import { adicionarPagamento, adicionarProduto, finalizarVenda } from '../../src/main/vendas/vendas'
import { entrada, XML_EXEMPLO } from '../ajuda'

describe('lista de compras', () => {
  let db: Banco
  let leite: number
  let acucar: number
  let pao: number

  beforeEach(() => {
    db = abrirBanco(':memory:')
    leite = criarProduto(db, entrada({ ean: '7891000100103', descricao: 'Leite Condensado', precoVenda: 749, estoqueAtual: 0, estoqueMinimo: 6000 })).id
    acucar = criarProduto(db, entrada({ ean: '7891000100110', descricao: 'Açúcar', precoVenda: 549, estoqueAtual: 0, estoqueMinimo: 5000 })).id
    pao = criarProduto(db, entrada({ descricao: 'Pão de Forma', precoVenda: 899, precoCusto: 600, estoqueAtual: 10_000, estoqueMinimo: 3000 })).id
    // Vínculo com o fornecedor (fator 24 do leite) vem da nota.
    confirmarEntrada(db, lerNfe(XML_EXEMPLO), [
      { numero: 1, acao: 'vincular', produtoId: leite, fator: 24, precoVenda: null },
      { numero: 2, acao: 'vincular', produtoId: acucar, fator: 1, precoVenda: null },
      { numero: 3, acao: 'ignorar' }
    ])
    // Estoque agora: leite 48, açúcar 10, pão 10. Vende para gerar média e chegar no mínimo.
    abrirCaixa(db, 'Maria', 0)
    const vender = (id: number, un: number, preco: number) => {
      adicionarProduto(db, id, un * 1000)
      adicionarPagamento(db, 'dinheiro', un * preco)
      finalizarVenda(db)
    }
    vender(leite, 45, 749) // sobra 3 (mínimo 6) · média 45/30 = 1,5/dia
    vender(acucar, 6, 549) // sobra 4 (mínimo 5) · média 0,2/dia
    vender(pao, 8, 899) // sobra 2 (mínimo 3), sem fornecedor
  })

  it('agrupa por fornecedor, arredonda para embalagem e calcula o custo estimado', () => {
    const { grupos, diasCobertura } = listaCompras(db, 7)
    expect(diasCobertura).toBe(7)
    expect(grupos.map((g) => g.fornecedor)).toEqual(['Distribuidora Exemplo', 'Sem fornecedor (produto nunca entrou por nota)'])

    const [dist, sem] = grupos
    const l = dist!.itens.find((i) => i.descricao === 'Leite Condensado')!
    // 1,5/dia × 7 = 10,5 → 11 − 3 = 8 → 1 caixa de 24.
    expect(l).toMatchObject({ mediaDiaria: 1500, fator: 24, embalagens: 1, sugerido: 24_000, codigoFornecedor: '000123', custoUnitario: 516 })
    expect(l.custoEstimado).toBe(12_384)
    expect(textoQuantidade(l)).toBe('1 emb. de 24 un')

    // Açúcar: 0,2 × 7 = 1,4 → 2 − 4 < 0; falta 1 para o mínimo → pede 1 un.
    expect(dist!.itens.find((i) => i.descricao === 'Açúcar')).toMatchObject({ sugerido: 1000, embalagens: null })
    expect(sem!.itens).toMatchObject([{ descricao: 'Pão de Forma', custoUnitario: 600 }])
  })

  it('mais dias de cobertura, pedido maior', () => {
    const l = listaCompras(db, 30).grupos[0]!.itens.find((i) => i.descricao === 'Leite Condensado')!
    // 1,5 × 30 = 45 − 3 = 42 → 2 caixas.
    expect(l.embalagens).toBe(2)
  })

  it('pedido pronto para o WhatsApp do representante', () => {
    const [dist] = listaCompras(db, 7).grupos
    const p = pedidoWhatsApp(db, dist!)
    expect(p.texto).toContain('• 1 emb. de 24 un — Leite Condensado (cód. 000123)')
    expect(p.texto).toContain('• 1 un — Açúcar (cód. 000456)')
    // O telefone da nota é fixo (10 dígitos com DDD): vira o destinatário.
    expect(p.link.startsWith('https://wa.me/551133334444?text=')).toBe(true)
  })
})
