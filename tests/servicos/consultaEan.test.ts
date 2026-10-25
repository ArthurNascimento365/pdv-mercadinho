import { beforeEach, describe, expect, it, vi } from 'vitest'
import { abrirBanco, type Banco } from '../../src/main/db/conexao'
import { criarProduto } from '../../src/main/repos/produtos'
import { consultarEan } from '../../src/main/servicos/consultaEan'
import { consultarOpenFoodFacts, SemConexao, type Buscador } from '../../src/main/servicos/openFoodFacts'
import { entrada } from '../ajuda'

const EAN = '7891000100103'

const respostaJson = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })

describe('consultarOpenFoodFacts', () => {
  it('monta a descrição com nome, marca e quantidade', async () => {
    const buscar = vi.fn<Buscador>(async () =>
      respostaJson({
        status: 1,
        product: { product_name_pt: 'Leite Condensado', brands: 'Moça,Nestlé', quantity: '395 g' }
      })
    )
    const s = await consultarOpenFoodFacts(EAN, buscar)
    expect(s).toEqual({ ean: EAN, descricao: 'Leite Condensado Moça 395 g', marca: 'Moça', base: 'alimentos' })
    const [url, init] = buscar.mock.calls[0]!
    expect(url).toContain(`/product/${EAN}`)
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/PDV-Mercadinho/)
  })

  it('consulta todas as bases (alimentos, beleza, pet, produtos) seguindo o redirecionamento', async () => {
    const buscar = vi.fn<Buscador>(async () =>
      respostaJson({
        status: 1,
        product: { product_name_pt: 'Detergente Ypê Clear', brands: 'Ype', quantity: '500 ml', product_type: 'product' }
      })
    )
    const s = await consultarOpenFoodFacts('7896098900253', buscar)
    const [url, init] = buscar.mock.calls[0]!
    expect(url).toContain('product_type=all')
    expect(init.redirect).toBe('follow')
    // "Ypê" no nome já é a marca "Ype": não repete.
    expect(s).toEqual({ ean: '7896098900253', descricao: 'Detergente Ypê Clear 500 ml', marca: 'Ype', base: 'produtos' })
  })

  it.each([
    ['beauty', 'beleza'],
    ['petfood', 'pet'],
    ['food', 'alimentos'],
    [undefined, 'alimentos']
  ])('product_type %s → base %s', async (tipo, base) => {
    const s = await consultarOpenFoodFacts(EAN, async () =>
      respostaJson({ status: 1, product: { product_name: 'Item', product_type: tipo } })
    )
    expect(s?.base).toBe(base)
  })

  it('não repete marca nem quantidade que já estão no nome', async () => {
    const s = await consultarOpenFoodFacts(EAN, async () =>
      respostaJson({ status: 1, product: { product_name: 'Nescau 2.0 400g', brands: 'Nescau', quantity: '400 g' } })
    )
    expect(s?.descricao).toBe('Nescau 2.0 400g')
  })

  it('null quando não existe', async () => {
    expect(await consultarOpenFoodFacts(EAN, async () => respostaJson({ status: 0 }, 404))).toBeNull()
    expect(await consultarOpenFoodFacts(EAN, async () => respostaJson({ status: 0 }))).toBeNull()
    expect(await consultarOpenFoodFacts(EAN, async () => respostaJson({ status: 1, product: {} }))).toBeNull()
  })

  it('SemConexao quando falha a rede ou o servidor', async () => {
    await expect(
      consultarOpenFoodFacts(EAN, async () => {
        throw new TypeError('fetch failed')
      })
    ).rejects.toBeInstanceOf(SemConexao)
    await expect(consultarOpenFoodFacts(EAN, async () => respostaJson({}, 503))).rejects.toBeInstanceOf(SemConexao)
  })
})

describe('consultarEan', () => {
  let db: Banco
  beforeEach(() => {
    db = abrirBanco(':memory:')
  })

  it('local primeiro, sem ir à internet', async () => {
    criarProduto(db, entrada({ ean: EAN }))
    const remoto = vi.fn()
    const r = await consultarEan(db, EAN, remoto)
    expect(r.origem).toBe('local')
    expect(remoto).not.toHaveBeenCalled()
  })

  it('depois o Open Food Facts', async () => {
    const sugestao = { ean: EAN, descricao: 'Leite', marca: null, base: 'alimentos' as const }
    expect(await consultarEan(db, EAN, async () => sugestao)).toEqual({ origem: 'openfoodfacts', sugestao })
  })

  it('por fim, manual', async () => {
    expect(await consultarEan(db, EAN, async () => null)).toEqual({ origem: 'manual', motivo: 'nao-encontrado' })
    expect(
      await consultarEan(db, EAN, async () => {
        throw new SemConexao('offline')
      })
    ).toEqual({ origem: 'manual', motivo: 'sem-internet' })
  })

  it('EAN inválido nem consulta', async () => {
    const remoto = vi.fn()
    expect(await consultarEan(db, '123', remoto)).toEqual({ origem: 'manual', motivo: 'ean-invalido' })
    expect(remoto).not.toHaveBeenCalled()
  })
})
