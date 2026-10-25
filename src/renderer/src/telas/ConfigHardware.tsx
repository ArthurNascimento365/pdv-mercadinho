import { useEffect, useState } from 'react'
import { quantidadeParaTexto } from '@shared/dinheiro'
import {
  MODOS_IMPRESSORA,
  MOTIVOS_BALANCA,
  type ConfigBalancaSerial,
  type ConfigImpressora,
  type Diagramado,
  type ModoImpressora,
  type PortaSerialInfo
} from '@shared/impressao'
import { mensagemErro } from '../util'

interface Props {
  impressora: ConfigImpressora
  balanca: ConfigBalancaSerial
  onImpressora: (c: ConfigImpressora) => void
  onBalanca: (c: ConfigBalancaSerial) => void
  /** Salva tudo antes de um teste, para testar o que está na tela. */
  salvar: () => Promise<boolean>
  /** Abre a pré-visualização (a tela de cima controla o modal e os atalhos). */
  onPrevia: (d: Diagramado) => void
}

const BAUDS = [2400, 4800, 9600, 19200, 38400, 57600, 115200]

export function ConfigHardware({
  impressora: imp,
  balanca: bal,
  onImpressora,
  onBalanca,
  salvar,
  onPrevia
}: Props): React.JSX.Element {
  const [impressoras, setImpressoras] = useState<string[]>([])
  const [portas, setPortas] = useState<PortaSerialInfo[]>([])
  const [resultado, setResultado] = useState<{ erro: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    window.pdv.hardware.impressorasWindows().then(setImpressoras).catch(() => setImpressoras([]))
    window.pdv.hardware.portasSerial().then(setPortas).catch(() => setPortas([]))
  }, [])

  const imp_ = <K extends keyof ConfigImpressora>(campo: K, valor: ConfigImpressora[K]): void =>
    onImpressora({ ...imp, [campo]: valor })

  async function testar(acao: () => Promise<string>): Promise<void> {
    if (ocupado) return
    setOcupado(true)
    setResultado(null)
    try {
      if (!(await salvar())) return
      setResultado({ erro: false, texto: await acao() })
    } catch (e) {
      setResultado({ erro: true, texto: mensagemErro(e) })
    } finally {
      setOcupado(false)
    }
  }

  const portaSelect = (valor: string, mudar: (v: string) => void): React.JSX.Element => (
    <select value={valor} onChange={(e) => mudar(e.target.value)}>
      <option value="">— escolha —</option>
      {portas.map((p) => (
        <option key={p.caminho} value={p.caminho}>
          {p.nome}
        </option>
      ))}
      {valor && !portas.some((p) => p.caminho === valor) && <option value={valor}>{valor} (não encontrada)</option>}
    </select>
  )

  const usaEscPos = imp.modo === 'windows' || imp.modo === 'rede' || imp.modo === 'serial'

  return (
    <>
      <section className="secao">
        <h3>Impressora de cupom</h3>
        <label>
          Tipo de conexão
          <select value={imp.modo} onChange={(e) => imp_('modo', e.target.value as ModoImpressora)}>
            {Object.entries(MODOS_IMPRESSORA).map(([v, nome]) => (
              <option key={v} value={v}>
                {nome}
              </option>
            ))}
          </select>
        </label>

        {(imp.modo === 'windows' || imp.modo === 'driver') && (
          <label>
            Impressora instalada no Windows
            <select value={imp.nome} onChange={(e) => imp_('nome', e.target.value)}>
              <option value="">— escolha —</option>
              {impressoras.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            {imp.modo === 'windows' && (
              <small>
                Use o driver do fabricante (Elgin, Bematech, Epson...) ou "Generic / Text Only". O PDV envia ESC/POS
                direto, sem passar pelo layout do driver.
              </small>
            )}
          </label>
        )}

        {imp.modo === 'rede' && (
          <div className="grade">
            <label>
              IP da impressora
              <input value={imp.host} placeholder="192.168.0.50" onChange={(e) => imp_('host', e.target.value)} />
            </label>
            <label>
              Porta TCP
              <input
                value={imp.porta}
                inputMode="numeric"
                onChange={(e) => imp_('porta', Number(e.target.value.replace(/\D/g, '')) || 0)}
              />
            </label>
          </div>
        )}

        {imp.modo === 'serial' && (
          <div className="grade">
            <label>
              Porta
              {portaSelect(imp.serial, (v) => imp_('serial', v))}
            </label>
            <label>
              Velocidade (baud)
              <select value={imp.baud} onChange={(e) => imp_('baud', Number(e.target.value))}>
                {BAUDS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {imp.modo !== 'nenhuma' && (
          <>
            <div className="grade">
              <label>
                Largura do papel
                <select value={imp.colunas} onChange={(e) => imp_('colunas', Number(e.target.value) as 32 | 42 | 48)}>
                  <option value={48}>80 mm · 48 colunas</option>
                  <option value={42}>80 mm · 42 colunas</option>
                  <option value={32}>58 mm · 32 colunas</option>
                </select>
              </label>
              {usaEscPos && (
                <label>
                  Tabela de caracteres (acentos)
                  <select
                    value={imp.acentos}
                    onChange={(e) => imp_('acentos', e.target.value as ConfigImpressora['acentos'])}
                  >
                    <option value="cp850">PC850 Multilíngue (padrão)</option>
                    <option value="cp860">PC860 Português</option>
                    <option value="sem">Sem acentos</option>
                  </select>
                </label>
              )}
              {usaEscPos && (
                <label>
                  Gaveta de dinheiro
                  <select value={imp.gaveta} onChange={(e) => imp_('gaveta', e.target.value as ConfigImpressora['gaveta'])}>
                    <option value="pino2">Ligada na impressora (pino 2, padrão)</option>
                    <option value="pino5">Ligada na impressora (pino 5)</option>
                    <option value="nao">Sem gaveta</option>
                  </select>
                </label>
              )}
              <label className="opcao">
                <input type="checkbox" checked={imp.imprimirAutomatico} onChange={(e) => imp_('imprimirAutomatico', e.target.checked)} />
                Imprimir o cupom ao finalizar a venda (desmarcado: só com F12)
              </label>
              {usaEscPos && (
                <label className="opcao">
                  <input type="checkbox" checked={imp.cortar} onChange={(e) => imp_('cortar', e.target.checked)} />
                  Cortar o papel (guilhotina)
                </label>
              )}
            </div>
            <div className="grade">
              <label>
                Cabeçalho (até 4 linhas: CNPJ, endereço, telefone)
                <textarea rows={3} value={imp.cabecalho} maxLength={300} onChange={(e) => imp_('cabecalho', e.target.value)} />
              </label>
              <label>
                Rodapé
                <textarea rows={3} value={imp.rodape} maxLength={200} onChange={(e) => imp_('rodape', e.target.value)} />
              </label>
            </div>
          </>
        )}

        <div className="acoes">
          <button
            onClick={() =>
              void testar(async () => {
                onPrevia(await window.pdv.hardware.previa('teste'))
                return 'Pré-visualização aberta.'
              })
            }
            disabled={ocupado}
          >
            Ver cupom de teste
          </button>
          {imp.modo !== 'nenhuma' && (
            <button
              onClick={() =>
                void testar(async () => {
                  await window.pdv.hardware.imprimirTeste()
                  return 'Página de teste enviada. Confira os acentos e a régua de colunas.'
                })
              }
              disabled={ocupado}
            >
              Imprimir teste
            </button>
          )}
          {usaEscPos && imp.gaveta !== 'nao' && (
            <button
              onClick={() =>
                void testar(async () => {
                  await window.pdv.hardware.abrirGaveta()
                  return 'Comando de abrir gaveta enviado.'
                })
              }
              disabled={ocupado}
            >
              Abrir gaveta
            </button>
          )}
        </div>
      </section>

      <section className="secao">
        <h3>Leitura de peso da balança (serial)</h3>
        <p className="dica">
          Para balanças ligadas no computador (Toledo Prix, Filizola, Urano no protocolo Toledo). Balança que imprime
          etiqueta não precisa disto: a etiqueta já traz o peso.
        </p>
        <div className="grade">
          <label>
            Leitura
            <select value={bal.modo} onChange={(e) => onBalanca({ ...bal, modo: e.target.value as ConfigBalancaSerial['modo'] })}>
              <option value="nenhuma">Desligada (peso digitado)</option>
              <option value="serial">Balança na porta serial</option>
            </select>
          </label>
          {bal.modo === 'serial' && (
            <>
              <label>
                Porta
                {portaSelect(bal.porta, (v) => onBalanca({ ...bal, porta: v }))}
              </label>
              <label>
                Velocidade (baud)
                <select
                  value={bal.baud}
                  onChange={(e) => onBalanca({ ...bal, baud: Number(e.target.value) as ConfigBalancaSerial['baud'] })}
                >
                  {[2400, 4800, 9600].map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
        {bal.modo === 'serial' && (
          <div className="acoes">
            <button
              onClick={() =>
                void testar(async () => {
                  const r = await window.pdv.hardware.lerPeso()
                  if (!r.ok) throw new Error(MOTIVOS_BALANCA[r.motivo])
                  return `Peso lido: ${quantidadeParaTexto(r.gramas, 'KG')} kg`
                })
              }
              disabled={ocupado}
            >
              Ler peso agora
            </button>
          </div>
        )}
      </section>

      {resultado && <p className={resultado.erro ? 'erro' : 'aviso'}>{resultado.texto}</p>}
    </>
  )
}
