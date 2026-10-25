import type { Diagramado } from '@shared/impressao'
import { useTeclas } from '../util'
import { QrSvg } from './QrPix'

/** Mostra o cupom exatamente como sai na bobina (mesma diagramação da impressora). */
export function PreviaCupom({
  titulo,
  documento,
  onImprimir,
  onFechar
}: {
  titulo: string
  documento: Diagramado
  onImprimir?: () => void
  onFechar: () => void
}): React.JSX.Element {
  useTeclas({ Escape: onFechar, Enter: onFechar, ...(onImprimir ? { F12: onImprimir } : {}) })

  return (
    <div className="fundo-modal">
      <div className="modal modal-cupom">
        <h2>{titulo}</h2>
        <div className="bobina" style={{ width: `${documento.colunas + 4}ch` }}>
          {documento.linhas.map((l, i) =>
            l.qr !== undefined ? (
              <div key={i} className="bobina-qr">
                <QrSvg conteudo={l.qr} />
              </div>
            ) : (
              <pre key={i} className={l.grande ? 'grande' : l.negrito ? 'negrito' : ''}>
                {l.texto || ' '}
              </pre>
            )
          )}
        </div>
        <div className="acoes">
          <span className="espaco" />
          {onImprimir && (
            <button className="secundario" onClick={onImprimir}>
              <kbd>F12</kbd> Imprimir
            </button>
          )}
          <button className="primario" onClick={onFechar}>
            <kbd>Esc</kbd> Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
