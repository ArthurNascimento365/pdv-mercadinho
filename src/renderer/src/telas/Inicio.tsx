import { useEffect, useState } from 'react'
import { backupAtrasado, type ResultadoBackup } from '@shared/backup'
import type { ResumoCaixa } from '@shared/caixa'
import { formatarMoeda } from '@shared/dinheiro'
import type { AlertasValidade } from '@shared/estoque'
import type { InfoSistema } from '@shared/ipc'
import type { Tela } from '../App'
import { Icone, type NomeIcone } from '../componentes/Icone'
import { mensagemErro, useTeclas } from '../util'

interface Modulo {
  tecla: string
  nome: string
  descricao: string
  icone: NomeIcone
  tela: Tela
}

const MODULOS: Modulo[] = [
  { tecla: 'F2', nome: 'Vender', descricao: 'Frente de caixa', icone: 'carrinho', tela: 'vender' },
  { tecla: 'F3', nome: 'Produtos', descricao: 'Cadastro, preços e etiquetas', icone: 'pacote', tela: 'produtos' },
  { tecla: 'F4', nome: 'Caixa', descricao: 'Abertura, sangria e fechamento', icone: 'caixa', tela: 'caixa' },
  { tecla: 'F5', nome: 'Estoque e entrada', descricao: 'NF-e, validade e compras', icone: 'pacote', tela: 'estoque' },
  { tecla: 'F6', nome: 'Fiado', descricao: 'Clientes e cobrança', icone: 'pessoa', tela: 'fiado' },
  { tecla: 'F7', nome: 'Relatórios', descricao: 'Vendas, margem e curva ABC', icone: 'grafico', tela: 'relatorios' },
  { tecla: 'F8', nome: 'Backup', descricao: 'Cópias e restauração', icone: 'nuvem', tela: 'backup' },
  { tecla: 'F9', nome: 'Configurações', descricao: 'Loja, Pix, balança e impressora', icone: 'engrenagem', tela: 'configuracoes' }
]

type Gravidade = 'ok' | 'atencao' | 'critico'

interface Status {
  gravidade: Gravidade
  icone: NomeIcone
  titulo: string
  detalhe: string
  tecla: string
  tela: Tela
}

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`

function haQuanto(iso: string): string {
  const horas = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (horas < 1) return 'há menos de 1 hora'
  if (horas < 48) return `há ${plural(horas, 'hora', 'horas')}`
  return `há ${Math.floor(horas / 24)} dias`
}

function statusCaixa(caixa: ResumoCaixa | null): Status {
  return caixa
    ? {
        gravidade: 'ok',
        icone: 'caixa',
        titulo: `Caixa ${caixa.id} aberto`,
        detalhe: `${caixa.operador} · ${plural(caixa.vendas.quantidade, 'venda', 'vendas')} · ${formatarMoeda(caixa.vendas.total)}`,
        tecla: 'F4',
        tela: 'caixa'
      }
    : { gravidade: 'critico', icone: 'caixa', titulo: 'Caixa fechado', detalhe: 'Abra antes de vender', tecla: 'F4', tela: 'caixa' }
}

function statusBackup(ultimo: ResultadoBackup | null): Status {
  const base = { icone: 'nuvem' as const, tecla: 'F8', tela: 'backup' as const }
  if (!ultimo) return { ...base, gravidade: 'critico', titulo: 'Sem backup', detalhe: 'Nenhum backup feito ainda' }
  if (!ultimo.ok) return { ...base, gravidade: 'critico', titulo: 'Backup falhou', detalhe: `Último ${haQuanto(ultimo.quando)}` }
  if (backupAtrasado(ultimo)) {
    return { ...base, gravidade: 'critico', titulo: 'Backup atrasado', detalhe: `Último ${haQuanto(ultimo.quando)}` }
  }
  return { ...base, gravidade: 'ok', titulo: 'Backup em dia', detalhe: `Último ${haQuanto(ultimo.quando)}` }
}

function statusEstoque(noMinimo: number): Status {
  const base = { icone: 'pacote' as const, tecla: 'F5', tela: 'estoque' as const }
  return noMinimo > 0
    ? { ...base, gravidade: 'atencao', titulo: `${plural(noMinimo, 'produto', 'produtos')} no mínimo`, detalhe: 'Veja a lista de compras' }
    : { ...base, gravidade: 'ok', titulo: 'Estoque em dia', detalhe: 'Nada abaixo do mínimo' }
}

function statusValidade(v: AlertasValidade): Status {
  const base = { icone: 'alerta' as const, tecla: 'F5', tela: 'estoque' as const, titulo: 'Validade' }
  const n = v.vencidos.length + v.em7.length + v.em30.length
  if (n === 0) return { ...base, gravidade: 'ok', icone: 'ok', detalhe: 'Nada vencendo em 30 dias' }
  return {
    ...base,
    gravidade: v.vencidos.length + v.em7.length > 0 ? 'critico' : 'atencao',
    detalhe: `${plural(v.vencidos.length, 'vencido', 'vencidos')} · ${v.em7.length} em 7 dias · ${v.em30.length} em 30`
  }
}

export function Inicio({ onAbrir }: { onAbrir: (tela: Tela) => void }): React.JSX.Element {
  const [info, setInfo] = useState<InfoSistema | null>(null)
  const [status, setStatus] = useState<Status[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      window.pdv.sistema.info(),
      window.pdv.caixa.paraVender(),
      window.pdv.estoque.contarNoMinimo(),
      window.pdv.backup.estado(),
      window.pdv.validade.alertas()
    ])
      .then(([i, c, n, b, v]) => {
        setInfo(i)
        setStatus([statusCaixa(c), statusBackup(b.ultimo), statusEstoque(n), statusValidade(v)])
      })
      .catch((e: unknown) => setErro(mensagemErro(e)))
  }, [])

  useTeclas(Object.fromEntries(MODULOS.map((m) => [m.tecla, () => onAbrir(m.tela)])))

  return (
    <>
      <main className="inicio">
        {erro && <p className="erro">{erro}</p>}
        {status && (
          <div className="inicio-status">
            {status.map((s) => (
              <button key={s.titulo} className={`status status-${s.gravidade}`} onClick={() => onAbrir(s.tela)}>
                <span className="status-icone">
                  <Icone nome={s.icone} />
                </span>
                <span className="status-texto">
                  <b>{s.titulo}</b>
                  <small>{s.detalhe}</small>
                </span>
                <kbd>{s.tecla}</kbd>
              </button>
            ))}
          </div>
        )}
        <div className="modulos">
          {MODULOS.map((m) => (
            <button
              key={m.tecla}
              className={`modulo ${m.tela === 'vender' ? 'modulo-principal' : ''}`}
              onClick={() => onAbrir(m.tela)}
            >
              <kbd>{m.tecla}</kbd>
              <span className="modulo-icone">
                <Icone nome={m.icone} tamanho={28} />
              </span>
              <span className="modulo-nome">{m.nome}</span>
              <span className="modulo-descricao">{m.descricao}</span>
            </button>
          ))}
        </div>
      </main>

      <footer className="rodape">
        {info && (
          <>
            <span>v{info.versaoApp}</span>
            <span>schema {info.versaoSchema}</span>
            <span>SQLite {info.versaoSqlite}</span>
            <span className="caminho" title={info.caminhoBanco}>
              {info.caminhoBanco}
            </span>
          </>
        )}
      </footer>
    </>
  )
}
