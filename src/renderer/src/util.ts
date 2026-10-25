import { useEffect, useRef } from 'react'

function textoErro(erro: unknown): string {
  const texto = erro instanceof Error ? erro.message : String(erro)
  // O Electron prefixa erros de IPC com "Error invoking remote method '...': Error: ".
  return texto.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function mensagemErro(erro: unknown): string {
  return textoErro(erro).replace(/^\[\w+\] /, '')
}

/** A operação pode ser liberada com a senha do gerente. */
export function exigeGerente(erro: unknown): boolean {
  return textoErro(erro).startsWith('[gerente] ')
}

type MapaTeclas = Record<string, (e: KeyboardEvent) => void>

/**
 * Atalhos de teclado da tela. Chaves: "F2", "Escape", "Enter", "ArrowDown", "Ctrl+s"...
 * `ativo = false` desliga (ex.: enquanto um modal está aberto por cima).
 */
export function useTeclas(mapa: MapaTeclas, ativo = true): void {
  const ref = useRef(mapa)
  ref.current = mapa

  useEffect(() => {
    if (!ativo) return
    const ouvir = (e: KeyboardEvent): void => {
      const tecla = (e.ctrlKey ? 'Ctrl+' : '') + e.key
      const acao = ref.current[tecla]
      if (acao) {
        e.preventDefault()
        acao(e)
      }
    }
    window.addEventListener('keydown', ouvir)
    return () => window.removeEventListener('keydown', ouvir)
  }, [ativo])
}

let audio: AudioContext | null = null

/** Bipe grave curto: o operador percebe o erro sem olhar para a tela. */
export function bipeErro(): void {
  try {
    audio ??= new AudioContext()
    const osc = audio.createOscillator()
    const ganho = audio.createGain()
    osc.type = 'square'
    osc.frequency.value = 220
    ganho.gain.value = 0.08
    osc.connect(ganho).connect(audio.destination)
    osc.start()
    osc.stop(audio.currentTime + 0.18)
  } catch {
    // Sem saída de som: o aviso na tela basta.
  }
}

/** Margem sobre o preço de venda, ex.: "25,0%". */
export function textoMargem(venda: number | null, custo: number | null): string | null {
  if (venda === null || custo === null || venda <= 0) return null
  return `${(((venda - custo) / venda) * 100).toFixed(1).replace('.', ',')}%`
}
