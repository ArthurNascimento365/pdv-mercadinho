import type { Diagramado, Documento, LinhaDiagramada } from '@shared/impressao'

/** Quebra o texto em linhas de até `largura` caracteres, por palavra (palavra longa é cortada). */
export function quebrar(texto: string, largura: number): string[] {
  const linhas: string[] = []
  let atual = ''
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    let p = palavra
    while (p.length > largura) {
      if (atual) {
        linhas.push(atual)
        atual = ''
      }
      linhas.push(p.slice(0, largura))
      p = p.slice(largura)
    }
    if (!atual) atual = p
    else if (atual.length + 1 + p.length <= largura) atual += ` ${p}`
    else {
      linhas.push(atual)
      atual = p
    }
  }
  if (atual) linhas.push(atual)
  return linhas.length ? linhas : ['']
}

function alinhar(texto: string, largura: number, alinhamento: 'esquerda' | 'centro' | 'direita'): string {
  const sobra = largura - texto.length
  if (alinhamento === 'direita') return ' '.repeat(sobra) + texto
  if (alinhamento === 'centro') {
    const esq = Math.floor(sobra / 2)
    return ' '.repeat(esq) + texto + ' '.repeat(sobra - esq)
  }
  return texto + ' '.repeat(sobra)
}

/**
 * Transforma o documento em linhas com a largura exata da bobina. É a mesma diagramação
 * para a impressora e para a pré-visualização na tela. Texto "grande" (largura dupla)
 * usa metade das colunas.
 */
export function diagramar(doc: Documento, colunas: number): Diagramado {
  const linhas: LinhaDiagramada[] = []
  for (const l of doc) {
    const negrito = 'negrito' in l && !!l.negrito
    const grande = 'grande' in l && !!l.grande
    const largura = grande ? Math.floor(colunas / 2) : colunas
    const push = (texto: string): void => {
      linhas.push({ texto, negrito, grande })
    }

    switch (l.tipo) {
      case 'texto':
        for (const t of quebrar(l.texto, largura)) push(alinhar(t, largura, l.alinhamento ?? 'esquerda'))
        break
      case 'colunas': {
        // A descrição usa a linha toda; só a última precisa caber junto com o valor.
        // O recuo inicial (detalhe do item) é mantido em todas as linhas.
        const direita = l.direita.slice(0, largura)
        const recuo = /^ */.exec(l.esquerda)?.[0] ?? ''
        const partes = quebrar(l.esquerda, largura - recuo.length).map((p) => recuo + p)
        let ultima = partes.pop() ?? ''
        if (ultima.length + 1 + direita.length > largura) {
          partes.push(ultima)
          ultima = ''
        }
        for (const p of partes) push(alinhar(p, largura, 'esquerda'))
        push(ultima + ' '.repeat(largura - ultima.length - direita.length) + direita)
        break
      }
      case 'separador':
        push((l.caractere ?? '-').repeat(largura))
        break
      case 'espaco':
        push(' '.repeat(largura))
        break
      case 'qrcode':
        linhas.push({ texto: '', negrito: false, grande: false, qr: l.conteudo })
        break
    }
  }
  return { colunas, linhas }
}
