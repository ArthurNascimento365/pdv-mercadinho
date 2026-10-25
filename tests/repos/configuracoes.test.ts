import { describe, expect, it } from 'vitest'
import { abrirBanco } from '../../src/main/db/conexao'
import { definirConfig, obterConfig } from '../../src/main/repos/configuracoes'

describe('configurações', () => {
  it('vem com o nome padrão da loja', () => {
    const db = abrirBanco(':memory:')
    expect(obterConfig(db, 'loja.nome')).toBe('Mercadinho')
  })

  it('cria e atualiza', () => {
    const db = abrirBanco(':memory:')
    expect(obterConfig(db, 'pix.chave')).toBeNull()
    definirConfig(db, 'pix.chave', 'a@b.com')
    definirConfig(db, 'pix.chave', 'c@d.com')
    expect(obterConfig(db, 'pix.chave')).toBe('c@d.com')
  })
})
