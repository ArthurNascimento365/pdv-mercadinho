/** Ícones em SVG embutido (o PDV é offline: nada de fonte de ícones ou CDN). */
const DESENHOS = {
  codigo: <path d="M3 5v14M7 5v14M11 5v14M14 5v14M18 5v14M21 5v14" />,
  busca: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  carrinho: (
    <>
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M2 3h3l2.5 12h11l2-8H6" />
    </>
  ),
  caixa: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M3 12h18M8 7V4h8v3" />
    </>
  ),
  pacote: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </>
  ),
  pessoa: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </>
  ),
  grafico: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  nuvem: <path d="M7 18a5 5 0 1 1 1.5-9.8A6 6 0 0 1 20 11a4 4 0 0 1-1 7z" />,
  engrenagem: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  alerta: <path d="M12 3 2 20h20zM12 10v4M12 17v.5" />,
  relogio: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  ok: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  erro: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 16.5v.5" />
    </>
  ),
  voltar: <path d="M10 6 4 12l6 6M4 12h16" />
} satisfies Record<string, React.ReactNode>

export type NomeIcone = keyof typeof DESENHOS

export function Icone({ nome, tamanho = 20 }: { nome: NomeIcone; tamanho?: number }): React.JSX.Element {
  return (
    <svg className="icone" width={tamanho} height={tamanho} viewBox="0 0 24 24" aria-hidden="true">
      {DESENHOS[nome]}
    </svg>
  )
}
