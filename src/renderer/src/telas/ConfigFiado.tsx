import { useEffect, useRef, useState } from 'react'
import { mensagemErro, useTeclas } from '../util'

/** Dias de atraso tolerados e senha do gerente (libera fiado acima do limite/atrasado). */
export function ConfigFiado({
  diasAtraso,
  onDiasAtraso,
  onModal
}: {
  diasAtraso: string
  onDiasAtraso: (v: string) => void
  /** Avisa a tela de cima que há um modal aberto (para desligar os atalhos dela). */
  onModal: (aberto: boolean) => void
}): React.JSX.Element {
  const [temSenha, setTemSenha] = useState<boolean | null>(null)
  const [trocando, setTrocando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    window.pdv.gerente.temSenha().then(setTemSenha).catch(() => setTemSenha(null))
  }, [])

  const abrir = (v: boolean): void => {
    setTrocando(v)
    onModal(v)
  }

  return (
    <section className="secao">
      <h3>Fiado e gerente</h3>
      <div className="grade">
        <label>
          Bloquear fiado de quem tem compra em aberto há mais de (dias)
          <input value={diasAtraso} inputMode="numeric" onChange={(e) => onDiasAtraso(e.target.value.replace(/\D/g, ''))} />
        </label>
        <div>
          <p className="dica">
            Senha do gerente: {temSenha ? 'cadastrada' : 'não cadastrada'}. Ela libera venda no fiado acima do limite ou
            com atraso.
          </p>
          <div className="acoes">
            <button onClick={() => abrir(true)}>{temSenha ? 'Trocar senha do gerente' : 'Cadastrar senha do gerente'}</button>
          </div>
        </div>
      </div>
      {aviso && <p className="aviso">{aviso}</p>}
      {trocando && (
        <TrocarSenha
          exigeAtual={!!temSenha}
          onFeito={() => {
            abrir(false)
            setTemSenha(true)
            setAviso('Senha do gerente salva.')
          }}
          onFechar={() => abrir(false)}
        />
      )}
    </section>
  )
}

function TrocarSenha({
  exigeAtual,
  onFeito,
  onFechar
}: {
  exigeAtual: boolean
  onFeito: () => void
  onFechar: () => void
}): React.JSX.Element {
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const primeiro = useRef<HTMLInputElement>(null)

  useEffect(() => primeiro.current?.focus(), [])

  async function salvar(): Promise<void> {
    if (nova !== confirmacao) return setErro('A confirmação não bate com a nova senha')
    try {
      await window.pdv.gerente.definirSenha(nova, exigeAtual ? atual : null)
      onFeito()
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }

  useTeclas({ Escape: onFechar, F10: () => void salvar() })

  return (
    <div className="fundo-modal">
      <div className="modal modal-pequeno">
        <h2>Senha do gerente</h2>
        {exigeAtual && (
          <label>
            Senha atual
            <input ref={primeiro} type="password" value={atual} onChange={(e) => setAtual(e.target.value)} />
          </label>
        )}
        <label>
          Nova senha (mínimo 4 caracteres)
          <input
            ref={exigeAtual ? undefined : primeiro}
            type="password"
            value={nova}
            onChange={(e) => setNova(e.target.value)}
          />
        </label>
        <label>
          Repita a nova senha
          <input type="password" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} />
        </label>
        {erro && <p className="erro">{erro}</p>}
        <div className="acoes">
          <span className="espaco" />
          <button className="secundario" onClick={onFechar}>
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
