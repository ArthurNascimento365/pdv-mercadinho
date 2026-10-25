import { writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, shell } from 'electron'

/**
 * Gera um PDF A4 a partir de HTML (janela oculta, sem script), pergunta onde salvar e abre o
 * arquivo no leitor padrão. Retorna o caminho, ou null se o operador cancelou.
 */
export async function salvarPdf(html: string, nomePadrao: string, titulo: string): Promise<string | null> {
  const janela = new BrowserWindow({ show: false, webPreferences: { javascript: false } })
  let pdf: Buffer
  try {
    await janela.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    pdf = await janela.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } })
  } finally {
    janela.destroy()
  }
  const pai = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const opcoes = { title: titulo, defaultPath: nomePadrao, filters: [{ name: 'PDF', extensions: ['pdf'] }] }
  const r = pai ? await dialog.showSaveDialog(pai, opcoes) : await dialog.showSaveDialog(opcoes)
  if (r.canceled || !r.filePath) return null
  await writeFile(r.filePath, pdf)
  void shell.openPath(r.filePath)
  return r.filePath
}
