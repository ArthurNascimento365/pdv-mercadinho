import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { abrirBanco, type Banco } from './db/conexao'
import { ServicoBackup } from './backup/backup'
import { ServicoImpressao } from './impressao/servico'
import { transportesReais } from './impressao/transportes'
import { registrarIpc } from './ipc'

let db: Banco | null = null
let transportes: ReturnType<typeof transportesReais> | null = null

function criarJanela(): void {
  const janela = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: 'PDV Mercadinho',
    backgroundColor: '#f4f5f7',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  janela.once('ready-to-show', () => {
    janela.maximize()
    janela.show()
  })

  // Links externos (ex.: wa.me para cobrança do fiado) abrem no navegador padrão.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const urlDev = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && urlDev) {
    void janela.loadURL(urlDev)
  } else {
    void janela.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Duas instâncias gravando no mesmo banco é receita para problema no caixa.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const janela = BrowserWindow.getAllWindows()[0]
    if (janela) {
      if (janela.isMinimized()) janela.restore()
      janela.focus()
    }
  })

  app.whenReady().then(() => {
    const pastaDados = join(app.getPath('userData'), 'dados')
    mkdirSync(pastaDados, { recursive: true })
    const caminhoBanco = join(pastaDados, 'pdv.db')
    db = abrirBanco(caminhoBanco)
    transportes = transportesReais()
    const backup = new ServicoBackup(db, caminhoBanco, join(app.getPath('userData'), 'backups'), () => {
      db = null // já fechado pela restauração
      app.relaunch()
      app.exit(0)
    })
    registrarIpc({ db, caminhoBanco, impressao: new ServicoImpressao(db, transportes), backup })
    agendarBackup(backup)
    criarJanela()
  })

  app.on('window-all-closed', () => app.quit())

  app.on('will-quit', () => {
    transportes?.encerrar()
    try {
      db?.close()
    } catch {
      // já fechado
    }
    db = null
  })
}

/** Backup automático: confere a cada 10 min se passou o intervalo configurado (padrão 4 h). */
function agendarBackup(backup: ServicoBackup): void {
  const conferir = (): void => {
    if (!db) return
    try {
      if (backup.devido()) {
        void backup.fazer('automatico').then((r) => {
          if (!r.ok) console.error('[backup] falhou', r.destinos[0]?.erro)
        })
      }
    } catch (e) {
      console.error('[backup]', e)
    }
  }
  setTimeout(conferir, 60_000)
  setInterval(conferir, 10 * 60_000)
}
