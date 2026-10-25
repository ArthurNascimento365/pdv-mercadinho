import { beforeEach, describe, expect, it } from 'vitest'
import { abrirBanco, type Banco } from '../../src/main/db/conexao'
import {
  atualizarProduto,
  buscarProdutos,
  criarProduto,
  definirAtivo,
  listarCategorias,
  validarProdutoEntrada
} from '../../src/main/repos/produtos'
import { entrada } from '../ajuda'

const EAN = '7891000100103'

describe('produtos', () => {
  let db: Banco
  beforeEach(() => {
    db = abrirBanco(':memory:')
  })

  it('cria com categoria e devolve o produto completo', () => {
    const p = criarProduto(db, entrada({ ean: EAN }))
    expect(p).toMatchObject({ ean: EAN, descricao: 'Arroz Tipo 1 5kg', categoria: 'Mercearia', ativo: true })
    expect(p.categoriaId).toBeTypeOf('number')
  })

  it('reaproveita categoria ignorando maiúsculas', () => {
    criarProduto(db, entrada({ categoria: 'Mercearia' }))
    criarProduto(db, entrada({ descricao: 'Feijão', categoria: 'MERCEARIA' }))
    expect(listarCategorias(db)).toHaveLength(1)
  })

  it('normaliza descrição e EAN', () => {
    const p = criarProduto(db, entrada({ descricao: '  Café   Torrado ', ean: '7891 0001-00103' }))
    expect(p.descricao).toBe('Café Torrado')
    expect(p.ean).toBe(EAN)
  })

  it.each([
    [{ descricao: '' }, /descrição/],
    [{ ean: '7891000100104' }, /EAN .* inválido/],
    [{ precoVenda: 0 }, /preço de venda/i],
    [{ precoVenda: 12.5 }, /Preço de venda inválido/],
    [{ unidade: 'LT' }, /Unidade/],
    [{ codigoBalanca: 0 }, /balança/]
  ])('rejeita %j', (extra, mensagem) => {
    expect(() => validarProdutoEntrada({ ...entrada(), ...extra })).toThrow(mensagem)
  })

  it('não deixa repetir EAN nem código de balança', () => {
    criarProduto(db, entrada({ ean: EAN, codigoBalanca: 12 }))
    expect(() => criarProduto(db, entrada({ ean: EAN }))).toThrow(/já está cadastrado em "Arroz/)
    expect(() => criarProduto(db, entrada({ codigoBalanca: 12 }))).toThrow(/código de balança 12/)
  })

  it('atualiza e marca a data de mudança de preço só quando o preço muda', async () => {
    const p = criarProduto(db, entrada())
    await new Promise((r) => setTimeout(r, 5))
    const semMudarPreco = atualizarProduto(db, p.id, entrada({ descricao: 'Arroz Branco 5kg' }))
    expect(semMudarPreco.descricao).toBe('Arroz Branco 5kg')
    expect(semMudarPreco.precoAlteradoEm).toBe(p.precoAlteradoEm)

    await new Promise((r) => setTimeout(r, 5))
    const comPreco = atualizarProduto(db, p.id, entrada({ precoVenda: 2999 }))
    expect(comPreco.precoVenda).toBe(2999)
    expect(comPreco.precoAlteradoEm > p.precoAlteradoEm).toBe(true)
  })

  it('pode manter o próprio EAN ao atualizar', () => {
    const p = criarProduto(db, entrada({ ean: EAN }))
    expect(() => atualizarProduto(db, p.id, entrada({ ean: EAN, precoVenda: 100 }))).not.toThrow()
  })

  describe('busca', () => {
    beforeEach(() => {
      criarProduto(db, entrada({ descricao: 'Café Pilão 500g', ean: EAN }))
      criarProduto(db, entrada({ descricao: 'Açúcar Cristal 1kg' }))
      criarProduto(db, entrada({ descricao: 'Banana Prata', unidade: 'KG', codigoBalanca: 12 }))
      criarProduto(db, entrada({ descricao: 'Leite 100% integral' }))
    })

    const nomes = (termo: string) => buscarProdutos(db, termo).map((p) => p.descricao)

    it('ignora acento, maiúscula e ordem das palavras', () => {
      expect(nomes('acucar')).toEqual(['Açúcar Cristal 1kg'])
      expect(nomes('500 CAFE')).toEqual(['Café Pilão 500g'])
    })

    it('acha por EAN e código de balança', () => {
      expect(nomes(EAN)).toEqual(['Café Pilão 500g'])
      expect(nomes('12')).toEqual(['Banana Prata'])
    })

    it('trata % e _ como texto', () => {
      expect(nomes('100%')).toEqual(['Leite 100% integral'])
      expect(nomes('_')).toEqual([])
    })

    it('termo vazio lista tudo em ordem alfabética', () => {
      expect(nomes('')).toEqual(['Açúcar Cristal 1kg', 'Banana Prata', 'Café Pilão 500g', 'Leite 100% integral'])
    })

    it('esconde inativos, a não ser que peça', () => {
      const [banana] = buscarProdutos(db, 'banana')
      definirAtivo(db, banana!.id, false)
      expect(nomes('banana')).toEqual([])
      expect(buscarProdutos(db, 'banana', { incluirInativos: true })).toHaveLength(1)
    })
  })
})
