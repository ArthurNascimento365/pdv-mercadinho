import { useEffect, useState } from 'react'
import { Backup } from './telas/Backup'
import { Caixa } from './telas/Caixa'
import { Configuracoes } from './telas/Configuracoes'
import { Estoque } from './telas/Estoque'
import { Fiado } from './telas/Fiado'
import { Inicio } from './telas/Inicio'
import { Produtos } from './telas/Produtos'
import { Relatorios } from './telas/Relatorios'
import { Vender } from './telas/Vender'

export type Tela =
  | 'inicio'
  | 'vender'
  | 'produtos'
  | 'caixa'
  | 'estoque'
  | 'fiado'
  | 'relatorios'
  | 'backup'
  | 'configuracoes'

export function App(): React.JSX.Element {
  const [tela, setTela] = useState<Tela>('inicio')
  const [nomeLoja, setNomeLoja] = useState('')

  useEffect(() => {
    if (tela !== 'inicio') return
    window.pdv.config
      .obter('loja.nome')
      .then((nome) => setNomeLoja(nome ?? ''))
      .catch(() => setNomeLoja(''))
  }, [tela])

  const voltar = (): void => setTela('inicio')

  return (
    <div className="tela">
      <header className="topo">
        <h1>{nomeLoja || 'PDV Mercadinho'}</h1>
        <span className="selo">Offline · cupom não fiscal</span>
      </header>
      {tela === 'inicio' && <Inicio onAbrir={setTela} />}
      {tela === 'vender' && <Vender onVoltar={voltar} />}
      {tela === 'produtos' && <Produtos onVoltar={voltar} />}
      {tela === 'caixa' && <Caixa onVoltar={voltar} />}
      {tela === 'estoque' && <Estoque onVoltar={voltar} />}
      {tela === 'backup' && <Backup onVoltar={voltar} />}
      {tela === 'fiado' && <Fiado onVoltar={voltar} />}
      {tela === 'relatorios' && <Relatorios onVoltar={voltar} />}
      {tela === 'configuracoes' && <Configuracoes onVoltar={voltar} />}
    </div>
  )
}
