import { useEffect, useRef, useState } from 'react'
import { centavosParaTexto, formatarMoeda, lerMoeda } from '@shared/dinheiro'
import type { Cliente } from '@shared/fiado'
import { mensagemErro, useTeclas } from '../util'

/** Enter pula para o próximo campo; no último, deixa o atalho da tela agir. */
function proximoCampo(e: React.KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return
  const campos = Array.from(e.currentTarget.querySelectorAll<HTMLInputElement>('input'))
  const proximo = campos[campos.indexOf(e.target) + 1]
  if (proximo) {
    e.preventDefault()
    e.stopPropagation()
    proximo.focus()
  }
}

export function FormCliente({
  cliente,
  onFechar
}: {
  cliente: Cliente | null
  onFechar: (salvo?: Cliente) => void
}): React.JSX.Element {
  const [nome, setNome] = useState(cliente?.nome ?? '')
  const [telefone, setTelefone] = useState(cliente?.telefone ?? '')
  const [limite, setLimite] = useState(cliente ? centavosParaTexto(cliente.limite) : '100,00')
  const [dia, setDia] = useState(cliente?.diaAcerto ? String(cliente.diaAcerto) : '')
  const [obs, setObs] = useState(cliente?.observacao ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const refNome = useRef<HTMLInputElement>(null)

  useEffect(() => refNome.current?.focus(), [])

  async function salvar(): Promise<void> {
    setErro(null)
    const valorLimite = lerMoeda(limite)
    if (valorLimite === null || valorLimite < 0) return setErro('Limite inválido')
    const diaAcerto = dia.trim() === '' ? null : Number(dia)
    try {
      const entrada = { nome, telefone: telefone.trim() || null, limite: valorLimite, diaAcerto, observacao: obs.trim() || null }
      onFechar(cliente ? await window.pdv.fiado.atualizar(cliente.id, entrada) : await window.pdv.fiado.criar(entrada))
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }

  useTeclas({ Escape: () => onFechar(), F10: () => void salvar(), Enter: () => void salvar() })

  return (
    <div className="fundo-modal">
      <div className="modal" onKeyDown={proximoCampo}>
        <h2>{cliente ? 'Editar cliente' : 'Novo cliente do fiado'}</h2>
        <div className="grade">
          <label className="largo">
            Nome
            <input ref={refNome} value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} />
          </label>
          <label>
            Telefone / WhatsApp (com DDD)
            <input value={telefone} inputMode="tel" placeholder="(11) 98765-4321" onChange={(e) => setTelefone(e.target.value)} />
          </label>
          <label>
            Limite de crédito (R$)
            <input value={limite} inputMode="decimal" onChange={(e) => setLimite(e.target.value)} />
            <small>0 = só vende fiado com a senha do gerente</small>
          </label>
          <label>
            Dia de acerto (1 a 31)
            <input value={dia} inputMode="numeric" placeholder="opcional" onChange={(e) => setDia(e.target.value.replace(/\D/g, ''))} />
          </label>
          <label>
            Observação
            <input value={obs} maxLength={300} onChange={(e) => setObs(e.target.value)} />
          </label>
        </div>
        {erro && <p className="erro">{erro}</p>}
        <div className="acoes">
          <span className="espaco" />
          <button className="secundario" onClick={() => onFechar()}>
            <kbd>Esc</kbd> Cancelar
          </button>
          <button className="primario" onClick={() => void salvar()}>
            <kbd>F10</kbd> Salvar
          </button>
        </div>
      </div>
    </div>
  )
}

export function situacaoCliente(c: Cliente): { texto: string; alerta: boolean } {
  if (c.saldo <= 0) return { texto: c.saldo < 0 ? `crédito de ${formatarMoeda(-c.saldo)}` : 'em dia', alerta: false }
  const dias = c.diasEmAberto ?? 0
  return { texto: `deve ${formatarMoeda(c.saldo)} · ${dias} ${dias === 1 ? 'dia' : 'dias'}`, alerta: c.saldo > c.limite }
}

/** Escolha do cliente (para a venda no fiado). Del = venda sem cliente; F2 = cadastrar. */
export function BuscaCliente({
  onEscolher,
  onSemCliente,
  onFechar
}: {
  onEscolher: (c: Cliente) => void
  onSemCliente?: () => void
  onFechar: () => void
}): React.JSX.Element {
  const [termo, setTermo] = useState('')
  const [lista, setLista] = useState<Cliente[]>([])
  const [sel, setSel] = useState(0)
  const [novo, setNovo] = useState(false)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => campo.current?.focus(), [novo])
  useEffect(() => {
    let cancelado = false
    const t = setTimeout(() => {
      window.pdv.fiado
        .buscar(termo)
        .then((r) => {
          if (!cancelado) {
            setLista(r)
            setSel(0)
          }
        })
        .catch(() => undefined)
    }, 120)
    return () => {
      cancelado = true
      clearTimeout(t)
    }
  }, [termo])

  useTeclas(
    {
      Escape: onFechar,
      ArrowDown: () => setSel((s) => Math.min(s + 1, lista.length - 1)),
      ArrowUp: () => setSel((s) => Math.max(s - 1, 0)),
      Enter: () => {
        const c = lista[sel]
        if (c) onEscolher(c)
      },
      F2: () => setNovo(true),
      ...(onSemCliente ? { Delete: onSemCliente } : {})
    },
    !novo
  )

  return (
    <div className="fundo-modal">
      <div className="modal modal-largo">
        <h2>Cliente</h2>
        <input
          ref={campo}
          className="campo-grande"
          placeholder="Nome ou telefone"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
        />
        <div className="tabela-rolagem previa">
          <table className="tabela">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Telefone</th>
                <th className="num">Limite</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c, i) => {
                const s = situacaoCliente(c)
                return (
                  <tr key={c.id} className={i === sel ? 'selecionada' : ''} onClick={() => setSel(i)} onDoubleClick={() => onEscolher(c)}>
                    <td>{c.nome}</td>
                    <td className="codigo">{c.telefone ?? ''}</td>
                    <td className="num">{formatarMoeda(c.limite)}</td>
                    <td className={s.alerta ? 'baixo' : ''}>{s.texto}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {lista.length === 0 && <p className="vazio">Nenhum cliente. F2 cadastra.</p>}
        </div>
        <p className="dica">
          ↑ ↓ escolhe · Enter confirma · F2 novo cliente{onSemCliente ? ' · Del tira o cliente da venda' : ''} · Esc fecha
        </p>
      </div>
      {novo && (
        <FormCliente
          cliente={null}
          onFechar={(c) => {
            setNovo(false)
            if (c) onEscolher(c)
          }}
        />
      )}
    </div>
  )
}

/** Senha do gerente para liberar uma exceção (ex.: fiado acima do limite). */
export function SenhaGerente({
  motivo,
  onSenha,
  onFechar
}: {
  motivo: string
  /** Devolve o erro (senha errada) ou null se liberou. */
  onSenha: (senha: string) => Promise<string | null>
  onFechar: () => void
}): React.JSX.Element {
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => campo.current?.focus(), [])

  async function enviar(): Promise<void> {
    const problema = await onSenha(senha)
    if (problema) {
      setErro(problema)
      setSenha('')
      campo.current?.focus()
    }
  }

  useTeclas({ Escape: onFechar, Enter: () => void enviar() })

  return (
    <div className="fundo-modal">
      <div className="modal modal-pequeno">
        <h2>Liberação do gerente</h2>
        <p className="erro">{motivo}</p>
        <label>
          Senha do gerente
          <input ref={campo} type="password" className="campo-grande" value={senha} onChange={(e) => setSenha(e.target.value)} />
        </label>
        {erro && <p className="erro">{erro}</p>}
        <div className="acoes">
          <span className="espaco" />
          <button className="secundario" onClick={onFechar}>
            <kbd>Esc</kbd> Não liberar
          </button>
          <button className="primario" onClick={() => void enviar()}>
            <kbd>Enter</kbd> Liberar
          </button>
        </div>
      </div>
    </div>
  )
}
