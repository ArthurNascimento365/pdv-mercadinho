import { useEffect, useRef, useState } from 'react'
import { formatarMoeda, lerQuantidade, quantidadeParaTexto, totalItem } from '@shared/dinheiro'
import { MOTIVOS_BALANCA } from '@shared/impressao'
import type { Produto } from '@shared/produtos'
import { mensagemErro, useTeclas } from '../util'

/**
 * Pede o peso de um produto pesado. Com balança serial configurada, lê sozinha ao abrir
 * (F5 lê de novo); sem balança, o operador digita.
 */
export function PesoBalanca({
  produto,
  confirmar,
  onFechar
}: {
  produto: Produto
  /** Devolve a mensagem de erro, ou null se deu certo. */
  confirmar: (quantidade: number) => Promise<string | null>
  onFechar: () => void
}): React.JSX.Element {
  const [texto, setTexto] = useState('')
  const [lendo, setLendo] = useState(false)
  const [comBalanca, setComBalanca] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const campo = useRef<HTMLInputElement>(null)

  async function ler(): Promise<void> {
    setLendo(true)
    setErro(null)
    try {
      const r = await window.pdv.hardware.lerPeso()
      if (r.ok) {
        setTexto(quantidadeParaTexto(r.gramas, 'KG'))
        setComBalanca(true)
      } else if (r.motivo === 'desligada') {
        setComBalanca(false)
      } else {
        setComBalanca(true)
        setErro(MOTIVOS_BALANCA[r.motivo])
      }
    } catch (e) {
      setComBalanca(true)
      setErro(mensagemErro(e))
    } finally {
      setLendo(false)
      campo.current?.focus()
      campo.current?.select()
    }
  }

  useEffect(() => {
    void ler()
  }, [])

  async function enviar(): Promise<void> {
    const q = lerQuantidade(texto)
    if (q === null || q <= 0) {
      setErro('Peso inválido')
      campo.current?.select()
      return
    }
    try {
      const problema = await confirmar(q)
      if (problema) setErro(problema)
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }

  useTeclas({ Escape: onFechar, Enter: () => void enviar(), F5: () => void ler() })

  const q = lerQuantidade(texto)
  return (
    <div className="fundo-modal">
      <div className="modal modal-pequeno">
        <h2>{produto.descricao}</h2>
        <label>
          Peso em kg ({formatarMoeda(produto.precoVenda)}/kg)
          <input
            ref={campo}
            className="campo-grande"
            inputMode="decimal"
            value={texto}
            placeholder={lendo ? 'lendo a balança…' : '0,000'}
            onChange={(e) => setTexto(e.target.value)}
          />
        </label>
        {q !== null && q > 0 && <p className="dica">Total: {formatarMoeda(totalItem(produto.precoVenda, q))}</p>}
        <p className="dica">
          {!comBalanca
            ? 'Digite o peso. Ex.: 0,350 para 350 g.'
            : erro
              ? 'Digite o peso ou tecle F5 para ler a balança de novo.'
              : 'Peso lido da balança. F5 lê de novo; pode corrigir digitando.'}
        </p>
        {erro && <p className="erro">{erro}</p>}
        <div className="acoes">
          {comBalanca && (
            <button className="secundario" onClick={() => void ler()} disabled={lendo}>
              <kbd>F5</kbd> Ler balança
            </button>
          )}
          <span className="espaco" />
          <button className="secundario" onClick={onFechar}>
            <kbd>Esc</kbd> Cancelar
          </button>
          <button className="primario" onClick={() => void enviar()} disabled={lendo}>
            <kbd>Enter</kbd> Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}
