/** Minúsculas, sem acento e com espaços simples: base da busca e da comparação de nomes. */
export function normalizarBusca(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Escapa texto para colocar dentro de HTML (PDFs gerados pelo PDV). */
export function escaparHtml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Remove espaços das pontas e repetidos no meio. */
export function limparEspacos(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim()
}
