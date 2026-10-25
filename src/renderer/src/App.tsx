import { useEffect, useState } from 'react'
import type { ResumoCaixa } from '@shared/caixa'
import { Icone } from './componentes/Icone'
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

const NOMES: Record<Tela, string> = {
  inicio: 'Início',
  vender: 'Vender',
  produtos: 'Produtos',
  caixa: 'Caixa',
  estoque: 'Estoque e entrada',
  fiado: 'Fiado',
  relatorios: 'Relatórios',
  backup: 'Backup',
  configuracoes: 'Configurações'
}

const relogio = (): string => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export function App(): React.JSX.Element {
  const [tela, setTela] = useState<Tela>('inicio')
  const [nomeLoja, setNomeLoja] = useState('')
  const [caixa, setCaixa] = useState<ResumoCaixa | null>(null)
  const [hora, setHora] = useState(relogio)

  useEffect(() => {
    // A cada troca de tela: o nome pode ter mudado (Configurações) e o caixa aberto/fechado (F4).
    window.pdv.config
      .obter('loja.nome')
      .then((nome) => setNomeLoja(nome ?? ''))
      .catch(() => setNomeLoja(''))
    window.pdv.caixa
      .atual()
      .then(setCaixa)
      .catch(() => setCaixa(null))
  }, [tela])

  useEffect(() => {
    const t = setInterval(() => setHora(relogio()), 20_000)
    return () => clearInterval(t)
  }, [])

  const voltar = (): void => setTela('inicio')

  return (
    <div className="tela">
      <header className="topo">
        <h1>{nomeLoja || 'PDV Mercadinho'}</h1>
        {tela !== 'inicio' && <span className="topo-modulo">{NOMES[tela]}</span>}
        <div className="topo-direita">
          {caixa && (
            <span className="topo-chip">
              <Icone nome="caixa" tamanho={16} />
              Caixa {caixa.id} · {caixa.operador}
            </span>
          )}
          <span className="topo-chip">
            <Icone nome="relogio" tamanho={16} />
            {hora}
          </span>
          {tela === 'inicio' ? (
            <span className="topo-chip">Offline · cupom não fiscal</span>
          ) : (
            <button className="topo-voltar" onMouseDown={(e) => e.preventDefault()} onClick={voltar}>
              <kbd>Esc</kbd> Início
            </button>
          )}
        </div>
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
