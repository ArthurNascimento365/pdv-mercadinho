import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { formatarMoeda } from '@shared/dinheiro'

/** QR de qualquer conteúdo (usado na pré-visualização do cupom). */
export function QrSvg({ conteudo, tamanho = 160 }: { conteudo: string; tamanho?: number }): React.JSX.Element {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    QRCode.toString(conteudo, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      .then(setSvg)
      .catch(() => setSvg(''))
  }, [conteudo])
  // SVG gerado localmente pela biblioteca de QR (sem script), seguro para injetar.
  return <div className="qr" style={{ width: tamanho, height: tamanho }} dangerouslySetInnerHTML={{ __html: svg }} />
}

/** QR do Pix com o valor, gerado no PDV. A confirmação do recebimento é manual. */
export function QrPix({ valor, vendaId }: { valor: number | null; vendaId: number | null }): React.JSX.Element {
  const [pix, setPix] = useState<{ payload: string; svg: string } | null | undefined>(undefined)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!valor || valor <= 0) {
      setPix(undefined)
      return
    }
    let cancelado = false
    const t = setTimeout(() => {
      window.pdv.pix
        .gerar(valor, vendaId)
        .then((r) => {
          if (!cancelado) {
            setPix(r)
            setErro(null)
          }
        })
        .catch((e: unknown) => !cancelado && setErro(String(e)))
    }, 200)
    return () => {
      cancelado = true
      clearTimeout(t)
    }
  }, [valor, vendaId])

  if (erro) return <p className="erro">{erro}</p>
  if (pix === null) return <p className="dica">Cadastre a chave Pix em Configurações (F9) para mostrar o QR Code.</p>
  if (!pix || !valor) return <></>
  return (
    <div className="pix">
      <div className="qr" dangerouslySetInnerHTML={{ __html: pix.svg }} />
      <div>
        <strong>{formatarMoeda(valor)}</strong>
        <p className="dica">
          Cliente lê o QR no app do banco. Confira o recebimento no celular e só então tecle Enter. F7 imprime o QR.
        </p>
      </div>
    </div>
  )
}
