import { useEffect, useRef, useState } from 'react'
import type { FormatoBalanca } from '@shared/balanca'
import { formatarMoeda, quantidadeParaTexto } from '@shared/dinheiro'
import type { ConfigBalancaSerial, ConfigImpressora, Diagramado } from '@shared/impressao'
import type { CodigoResolvido } from '@shared/produtos'
import { PreviaCupom } from '../componentes/PreviaCupom'
import { mensagemErro, useTeclas } from '../util'
import type { ConfigPix } from '@shared/pix'
import { ConfigFiado } from './ConfigFiado'
import { ConfigHardware } from './ConfigHardware'

function desenhoEtiqueta(f: FormatoBalanca): string {
  const valor = f.tipoValor === 'preco' ? 'P' : 'G'
  return `2 ${'C'.repeat(f.digitosCodigo)} ${valor.repeat(11 - f.digitosCodigo)} D`
}

export function Configuracoes({ onVoltar }: { onVoltar: () => void }): React.JSX.Element {
  const [nomeLoja, setNomeLoja] = useState('')
  const [formato, setFormato] = useState<FormatoBalanca | null>(null)
  const [teste, setTeste] = useState('')
  const [resultadoTeste, setResultadoTeste] = useState<CodigoResolvido | null | 'nada'>(null)
  const [impressora, setImpressora] = useState<ConfigImpressora | null>(null)
  const [balancaSerial, setBalancaSerial] = useState<ConfigBalancaSerial | null>(null)
  const [previa, setPrevia] = useState<Diagramado | null>(null)
  const [pix, setPix] = useState<ConfigPix | null>(null)
  const [diasAtraso, setDiasAtraso] = useState('30')
  const [controleCaixa, setControleCaixa] = useState(true)
  const [modalFiado, setModalFiado] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const refNome = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([
      window.pdv.config.obter('loja.nome'),
      window.pdv.balanca.obterFormato(),
      window.pdv.hardware.obterConfig(),
      window.pdv.pix.obterConfig(),
      window.pdv.config.obter('fiado.dias_atraso'),
      window.pdv.caixa.controleLigado()
    ])
      .then(([nome, f, hw, p, dias, controle]) => {
        setControleCaixa(controle)
        setNomeLoja(nome ?? '')
        setFormato(f)
        setImpressora(hw.impressora)
        setBalancaSerial(hw.balanca)
        setPix(p)
        setDiasAtraso(dias ?? '30')
        refNome.current?.focus()
      })
      .catch((e: unknown) => setErro(mensagemErro(e)))
  }, [])

  /** Salva tudo; devolve false (com a mensagem na tela) se algo estiver inválido. */
  async function salvar(): Promise<boolean> {
    if (!formato || !impressora || !balancaSerial || !pix) return false
    setErro(null)
    setAviso(null)
    try {
      if (nomeLoja.trim() === '') throw new Error('Informe o nome da loja')
      const dias = Number(diasAtraso)
      if (!Number.isInteger(dias) || dias < 1 || dias > 365) throw new Error('Dias de atraso do fiado: de 1 a 365')
      await window.pdv.config.definir('loja.nome', nomeLoja.trim())
      await window.pdv.config.definir('fiado.dias_atraso', String(dias))
      await window.pdv.caixa.definirControle(controleCaixa)
      setPix(await window.pdv.pix.salvarConfig(pix))
      await window.pdv.balanca.definirFormato(formato)
      setImpressora(await window.pdv.hardware.salvarImpressora(impressora))
      setBalancaSerial(await window.pdv.hardware.salvarBalanca(balancaSerial))
      setAviso('Configurações salvas.')
      return true
    } catch (e) {
      setErro(mensagemErro(e))
      return false
    }
  }

  async function testar(): Promise<void> {
    if (!teste.trim()) return
    setErro(null)
    try {
      // Testa com o formato salvo: salve antes de testar um formato novo.
      setResultadoTeste((await window.pdv.produtos.resolverCodigo(teste.trim())) ?? 'nada')
    } catch (e) {
      setErro(mensagemErro(e))
    }
  }

  useTeclas(
    {
      Escape: onVoltar,
      F10: () => void salvar(),
      'Ctrl+s': () => void salvar()
    },
    previa === null && !modalFiado
  )

  if (!formato || !impressora || !balancaSerial || !pix) return <main className="pagina">{erro && <p className="erro">{erro}</p>}</main>

  return (
    <main className="pagina pagina-media">
      <div className="barra barra-fixa">
        <h2>Configurações</h2>
        {aviso && <p className="aviso">{aviso}</p>}
        {erro && <p className="erro">{erro}</p>}
        <span className="espaco" />
        <button className="primario" onClick={() => void salvar()}>
          <kbd>F10</kbd> Salvar
        </button>
      </div>

      <div className="secoes-colunas">
      <section className="secao">
        <h3>Loja</h3>
        <label>
          Nome da loja (aparece no topo e, depois, no cupom)
          <input ref={refNome} value={nomeLoja} maxLength={60} onChange={(e) => setNomeLoja(e.target.value)} />
        </label>
      </section>

      <section className="secao">
        <h3>Caixa</h3>
        <label className="opcao">
          <input type="checkbox" checked={controleCaixa} onChange={(e) => setControleCaixa(e.target.checked)} />
          Controlar abertura e fechamento do caixa
        </label>
        <p className="dica">
          {controleCaixa
            ? 'Ligado: para vender, alguém abre o caixa (F4) com o nome do operador e o fundo de troco, e no fim do turno fecha com a contagem.'
            : 'Desligado: para a loja em que o dono é o único operador. Vende direto, sem abrir nem fechar o caixa; o PDV mantém um caixa aberto em nome de "Dono". Sangria e fechamento continuam disponíveis no F4, se quiser usar.'}
        </p>
      </section>

      <section className="secao">
        <h3>Etiqueta da balança</h3>
        <p className="dica">
          Use o mesmo formato programado na balança (Toledo, Filizola, Urano). A etiqueta é um código de 13 dígitos
          começando com 2.
        </p>
        <div className="grade">
          <label>
            Dígitos do código do produto
            <select
              value={formato.digitosCodigo}
              onChange={(e) => setFormato({ ...formato, digitosCodigo: Number(e.target.value) as 4 | 5 | 6 })}
            >
              <option value={4}>4 dígitos</option>
              <option value={5}>5 dígitos</option>
              <option value={6}>6 dígitos</option>
            </select>
          </label>
          <label>
            A etiqueta traz
            <select
              value={formato.tipoValor}
              onChange={(e) => setFormato({ ...formato, tipoValor: e.target.value as 'preco' | 'peso' })}
            >
              <option value="preco">Preço total (centavos)</option>
              <option value="peso">Peso (gramas)</option>
            </select>
          </label>
        </div>
        <p>
          Formato: <code className="desenho">{desenhoEtiqueta(formato)}</code>{' '}
          <span className="dica">
            C = código · {formato.tipoValor === 'preco' ? 'P = preço' : 'G = gramas'} · D = dígito verificador
          </span>
        </p>

        <label>
          Testar leitura (bipe uma etiqueta ou um EAN, com o formato já salvo)
          <div className="linha-campo">
            <input
              value={teste}
              inputMode="numeric"
              onChange={(e) => setTeste(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void testar()
                }
              }}
            />
            <button onClick={() => void testar()}>Testar</button>
          </div>
        </label>
        {resultadoTeste === 'nada' && <p className="erro">Nenhum produto ativo para esse código.</p>}
        {resultadoTeste && resultadoTeste !== 'nada' && (
          <p className="aviso">
            {resultadoTeste.produto.descricao}
            {resultadoTeste.origem === 'balanca' && resultadoTeste.quantidade !== null && resultadoTeste.total !== null
              ? ` · ${quantidadeParaTexto(resultadoTeste.quantidade, 'KG')} kg · ${formatarMoeda(resultadoTeste.total)}`
              : ` · ${formatarMoeda(resultadoTeste.produto.precoVenda)} (${resultadoTeste.origem === 'plu' ? 'código da balança' : 'EAN'})`}
          </p>
        )}
      </section>

      <section className="secao">
        <h3>Pix</h3>
        <p className="dica">
          O PDV gera o QR Code com o valor da venda, sem banco e sem internet. A confirmação é manual: o operador confere
          o recebimento no celular. Em branco = Pix sem QR.
        </p>
        <div className="grade">
          <label className="largo">
            Chave Pix (CPF, CNPJ, telefone, e-mail ou aleatória)
            <input value={pix.chave} maxLength={77} onChange={(e) => setPix({ ...pix, chave: e.target.value })} />
          </label>
          <label>
            Nome do recebedor (como no banco, até 25 letras)
            <input value={pix.nome} maxLength={40} onChange={(e) => setPix({ ...pix, nome: e.target.value })} />
          </label>
          <label>
            Cidade (até 15 letras)
            <input value={pix.cidade} maxLength={30} onChange={(e) => setPix({ ...pix, cidade: e.target.value })} />
          </label>
        </div>
      </section>

      <ConfigFiado diasAtraso={diasAtraso} onDiasAtraso={setDiasAtraso} onModal={setModalFiado} />

      <ConfigHardware
        impressora={impressora}
        balanca={balancaSerial}
        onImpressora={setImpressora}
        onBalanca={setBalancaSerial}
        salvar={salvar}
        onPrevia={setPrevia}
      />
      </div>

      {previa && <PreviaCupom titulo="Cupom de teste" documento={previa} onFechar={() => setPrevia(null)} />}
    </main>
  )
}
