/**
 * Excel em português salva CSV com ";" e em Windows-1252; outras ferramentas usam "," e UTF-8.
 * Aqui decodificamos o arquivo e lemos as linhas sem depender de quem gerou.
 */

export function decodificarArquivo(bytes: Uint8Array): string {
  let texto: string
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    texto = new TextDecoder('windows-1252').decode(bytes)
  }
  return texto.replace(/^﻿/, '')
}

function detectarSeparador(primeiraLinha: string): string {
  const candidatos = [';', ',', '\t']
  let melhor = ';'
  let maior = -1
  for (const c of candidatos) {
    let n = 0
    let aspas = false
    for (const ch of primeiraLinha) {
      if (ch === '"') aspas = !aspas
      else if (ch === c && !aspas) n++
    }
    if (n > maior) {
      maior = n
      melhor = c
    }
  }
  return melhor
}

/** Lê o CSV em linhas de células. Aceita aspas, aspas duplicadas ("") e quebras de linha dentro de aspas. */
export function lerCsv(texto: string): string[][] {
  const separador = detectarSeparador(texto.split(/\r?\n/, 1)[0] ?? '')
  const linhas: string[][] = []
  let linha: string[] = []
  let celula = ''
  let aspas = false

  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]
    if (aspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          celula += '"'
          i++
        } else {
          aspas = false
        }
      } else {
        celula += ch
      }
    } else if (ch === '"') {
      aspas = true
    } else if (ch === separador) {
      linha.push(celula)
      celula = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++
      linha.push(celula)
      linhas.push(linha)
      linha = []
      celula = ''
    } else {
      celula += ch
    }
  }
  if (celula !== '' || linha.length > 0) {
    linha.push(celula)
    linhas.push(linha)
  }
  return linhas
}
