import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import QRCode from 'qrcode'
import { SerialPort } from 'serialport'
import type { ConfigBalancaSerial, Diagramado, PortaSerialInfo } from '@shared/impressao'
import { ErroNegocio } from '../erros'
import type { CanalSerial } from './balanca'
import { enviarRede } from './rede'

/** Como os bytes chegam à impressora. Os testes trocam por uma versão em memória. */
export interface Transportes {
  windows(nome: string, bytes: Uint8Array): Promise<void>
  rede(host: string, porta: number, bytes: Uint8Array): Promise<void>
  serial(caminho: string, baud: number, bytes: Uint8Array): Promise<void>
  driver(nome: string, documento: Diagramado): Promise<void>
}

const TIMEOUT_MS = 8000

export function enviarSerial(caminho: string, baud: number, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const porta = new SerialPort({ path: caminho, baudRate: baud, autoOpen: false })
    porta.open((erro) => {
      if (erro) return reject(new ErroNegocio(`Não abriu a porta ${caminho}: ${erro.message}`))
      porta.write(Buffer.from(bytes), (e) => {
        if (e) {
          porta.close()
          return reject(new ErroNegocio(`Falha ao enviar para ${caminho}: ${e.message}`))
        }
        porta.drain(() => porta.close(() => resolve()))
      })
    })
  })
}

/**
 * Envia bytes crus (RAW) para uma impressora instalada no Windows pelo spooler, via
 * winspool.drv. Um PowerShell fica aberto com o código C# já compilado (Add-Type), então
 * só a primeira impressão paga o tempo de compilação. Não precisa de Visual Studio.
 */
const SCRIPT_RAW = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class PdvRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool OpenPrinter(string nome, out IntPtr h, IntPtr padrao);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern int StartDocPrinter(IntPtr h, int nivel, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] dados, int n, out int escritos);
  static Win32Exception Erro() { return new Win32Exception(Marshal.GetLastWin32Error()); }
  public static void Enviar(string nome, byte[] dados) {
    IntPtr h;
    if (!OpenPrinter(nome, out h, IntPtr.Zero)) throw Erro();
    try {
      DOCINFO di = new DOCINFO();
      di.pDocName = "PDV Mercadinho";
      di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) throw Erro();
      try {
        if (!StartPagePrinter(h)) throw Erro();
        int escritos;
        if (!WritePrinter(h, dados, dados.Length, out escritos) || escritos != dados.Length) throw Erro();
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
'@
# Protocolo em ASCII puro (base64), para não depender da página de código do console:
# entrada "id nomeBase64 dadosBase64", saída "OK id" ou "ERRO id mensagemBase64".
$utf8 = [Text.Encoding]::UTF8
[Console]::Out.WriteLine('PRONTO')
while ($null -ne ($linha = [Console]::In.ReadLine())) {
  $partes = $linha.Split(' ')
  $id = $partes[0]
  try {
    $nome = $utf8.GetString([Convert]::FromBase64String($partes[1]))
    [PdvRaw]::Enviar($nome, [Convert]::FromBase64String($partes[2]))
    [Console]::Out.WriteLine("OK $id")
  } catch {
    $msg = $_.Exception.InnerException.Message
    if (-not $msg) { $msg = $_.Exception.Message }
    [Console]::Out.WriteLine("ERRO $id " + [Convert]::ToBase64String($utf8.GetBytes($msg)))
  }
}
`

export class FilaWindowsRaw {
  private processo: ChildProcessWithoutNullStreams | null = null
  private pronto: Promise<void> | null = null
  private proximoId = 1
  private pendentes = new Map<string, { resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  private sobra = ''

  constructor(private readonly pastaTemporaria: string) {}

  private iniciar(): Promise<void> {
    if (this.pronto) return this.pronto
    const script = join(this.pastaTemporaria, 'pdv-raw-print.ps1')
    writeFileSync(script, `﻿${SCRIPT_RAW}`, 'utf8')
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true
    })
    this.processo = p
    this.pronto = new Promise((resolve, reject) => {
      const limite = setTimeout(() => reject(new ErroNegocio('O serviço de impressão do Windows não iniciou')), 30_000)
      p.stdout.setEncoding('utf8')
      p.stdout.on('data', (texto: string) => {
        this.sobra += texto
        const linhas = this.sobra.split(/\r?\n/)
        this.sobra = linhas.pop() ?? ''
        for (const linha of linhas) {
          if (linha.trim() === 'PRONTO') {
            clearTimeout(limite)
            resolve()
          } else this.responder(linha.trim())
        }
      })
      p.on('exit', () => {
        clearTimeout(limite)
        reject(new ErroNegocio('O serviço de impressão do Windows parou'))
        for (const [, pend] of this.pendentes) {
          clearTimeout(pend.timer)
          pend.reject(new ErroNegocio('O serviço de impressão do Windows parou'))
        }
        this.pendentes.clear()
        this.processo = null
        this.pronto = null
      })
    })
    this.pronto.catch(() => undefined)
    return this.pronto
  }

  private responder(linha: string): void {
    const m = /^(OK|ERRO) (\S*)\s?(.*)$/.exec(linha)
    if (!m) return
    const [, status, id = '', base64 = ''] = m
    const pend = this.pendentes.get(id)
    if (!pend) return
    clearTimeout(pend.timer)
    this.pendentes.delete(id)
    const mensagem = Buffer.from(base64, 'base64').toString('utf8').replace(/\s+/g, ' ').trim()
    if (status === 'OK') pend.resolve()
    else pend.reject(new ErroNegocio(`Impressora do Windows: ${mensagem || 'falha ao imprimir'}`))
  }

  async enviar(impressora: string, bytes: Uint8Array): Promise<void> {
    await this.iniciar()
    const id = String(this.proximoId++)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendentes.delete(id)
        reject(new ErroNegocio('A impressora do Windows não respondeu a tempo'))
      }, TIMEOUT_MS * 2)
      this.pendentes.set(id, { resolve, reject, timer })
      const nome = Buffer.from(impressora, 'utf8').toString('base64')
      this.processo!.stdin.write(`${id} ${nome} ${Buffer.from(bytes).toString('base64')}\n`, 'ascii')
    })
  }

  encerrar(): void {
    this.processo?.kill()
  }
}

/** Fallback: imprime pelo driver (como uma página), útil para impressora sem ESC/POS. */
export async function imprimirPeloDriver(nome: string, d: Diagramado): Promise<void> {
  const larguraMm = d.colunas <= 32 ? 58 : 80
  const html = `<!doctype html><meta charset="utf-8"><style>
    @page { margin: 0; size: ${larguraMm}mm auto; }
    body { margin: 0; padding: 2mm; font: 9pt/1.25 Consolas, 'Courier New', monospace; }
    pre { margin: 0; white-space: pre; }
    .n { font-weight: bold; } .g { font-size: 18pt; font-weight: bold; }
    .qr { display: flex; justify-content: center; margin: 2mm 0; } .qr svg { width: 40mm; height: 40mm; }
  </style><body>${(
    await Promise.all(
      d.linhas.map(async (l) => {
        if (l.qr !== undefined) return `<div class="qr">${await QRCode.toString(l.qr, { type: 'svg', margin: 0 })}</div>`
        const t = l.texto.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        return `<pre class="${l.grande ? 'g' : l.negrito ? 'n' : ''}">${t || ' '}</pre>`
      })
    )
  ).join('')}</body>`

  const janela = new BrowserWindow({ show: false, webPreferences: { javascript: false } })
  try {
    await janela.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await new Promise<void>((resolve, reject) =>
      janela.webContents.print({ silent: true, deviceName: nome, printBackground: false }, (ok, motivo) =>
        ok ? resolve() : reject(new ErroNegocio(`Driver da impressora: ${motivo || 'falha ao imprimir'}`))
      )
    )
  } finally {
    janela.destroy()
  }
}

export function abrirCanalBalanca(cfg: ConfigBalancaSerial): Promise<CanalSerial> {
  return new Promise((resolve, reject) => {
    const porta = new SerialPort({
      path: cfg.porta,
      baudRate: cfg.baud,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
      autoOpen: false
    })
    porta.open((erro) => {
      if (erro) return reject(new ErroNegocio(`Não abriu a porta da balança (${cfg.porta}): ${erro.message}`))
      resolve({
        escrever: (bytes) => porta.write(Buffer.from(bytes)),
        aoReceber: (cb) => porta.on('data', (d: Buffer) => cb(d.toString('latin1'))),
        fechar: () => {
          if (porta.isOpen) porta.close()
        }
      })
    })
  })
}

export async function listarPortasSerial(): Promise<PortaSerialInfo[]> {
  const portas = await SerialPort.list()
  return portas.map((p) => {
    const nome = (p as { friendlyName?: string }).friendlyName
    return { caminho: p.path, nome: nome ?? p.path }
  })
}

export function transportesReais(): Transportes & { encerrar(): void } {
  const fila = new FilaWindowsRaw(app.getPath('temp'))
  return {
    windows: (nome, bytes) => fila.enviar(nome, bytes),
    rede: enviarRede,
    serial: enviarSerial,
    driver: imprimirPeloDriver,
    encerrar: () => fila.encerrar()
  }
}
