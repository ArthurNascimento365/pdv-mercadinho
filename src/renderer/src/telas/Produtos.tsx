import { useEffect, useRef, useState } from 'react'
import { formatarMoeda, quantidadeParaTexto } from '@shared/dinheiro'
import { noEstoqueMinimo } from '@shared/estoque'
import type { Produto } from '@shared/produtos'
import { Icone } from '../componentes/Icone'
import { mensagemErro, useTeclas } from '../util'
import { hojeLocal, precoTabela, promocaoAtiva } from '@shared/precos'
import { Etiquetas } from './Etiquetas'
import { FormProduto } from './FormProduto'
import { ImportarCsv } from './ImportarCsv'

export function Produtos({ onVoltar }: { onVoltar: () => void }): React.JSX.Element {
  const [termo, setTermo] = useState('')
  const [incluirInativos, setIncluirInativos] = useState(false)
  const [lista, setLista] = useState<Produto[]>([])
  const [selecionado, setSelecionado] = useState(0)
  const [editando, setEditando] = useState<Produto | 'novo' | null>(null)
  const [importando, setImportando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [recarregar, setRecarregar] = useState(0)
  const busca = useRef<HTMLInputElement>(null)
  const tabela = useRef<HTMLTableSectionElement>(null)

  useEffect(() => {
    let cancelado = false
    const espera = setTimeout(() => {
      window.pdv.produtos
        .buscar(termo, incluirInativos)
        .then((r) => {
          if (cancelado) return
          setLista(r)
          setSelecionado(0)
          setErro(null)
        })
        .catch((e: unknown) => !cancelado && setErro(mensagemErro(e)))
    }, 120)
    return () => {
      cancelado = true
      clearTimeout(espera)
    }
  }, [termo, incluirInativos, recarregar])

  useEffect(() => {
    tabela.current?.children[selecionado]?.scrollIntoView({ block: 'nearest' })
  }, [selecionado])

  const [etiquetas, setEtiquetas] = useState(false)
  const modalAberto = editando !== null || importando || etiquetas
  useEffect(() => {
    if (!modalAberto) busca.current?.focus()
  }, [modalAberto])

  useTeclas(
    {
      Escape: onVoltar,
      F2: () => setEditando('novo'),
      Insert: () => setEditando('novo'),
      F4: () => setImportando(true),
      F6: () => setEtiquetas(true),
      ArrowDown: () => setSelecionado((s) => Math.min(s + 1, lista.length - 1)),
      ArrowUp: () => setSelecionado((s) => Math.max(s - 1, 0)),
      PageDown: () => setSelecionado((s) => Math.min(s + 10, lista.length - 1)),
      PageUp: () => setSelecionado((s) => Math.max(s - 10, 0)),
      Enter: () => {
        const p = lista[selecionado]
        if (p) setEditando(p)
      }
    },
    !modalAberto
  )

  function fecharForm(salvo?: Produto): void {
    setEditando(null)
    if (salvo) {
      setAviso(`"${salvo.descricao}" salvo.`)
      setRecarregar((n) => n + 1)
    }
  }

  return (
    <main className="pagina">
      <div className="barra">
        <h2>Produtos</h2>
        <label className="campo-busca">
          <Icone nome="busca" />
          <input
            ref={busca}
            placeholder="Buscar por descrição, EAN ou código da balança"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
          />
        </label>
        <label className="opcao">
          <input
            type="checkbox"
            checked={incluirInativos}
            onChange={(e) => setIncluirInativos(e.target.checked)}
          />
          Mostrar inativos
        </label>
        <button onClick={() => setImportando(true)}>
          <kbd>F4</kbd> Importar CSV
        </button>
        <button onClick={() => setEtiquetas(true)}>
          <kbd>F6</kbd> Etiquetas
        </button>
        <button className="primario" onClick={() => setEditando('novo')}>
          <kbd>F2</kbd> Novo produto
        </button>
      </div>

      {aviso && <p className="aviso">{aviso}</p>}
      {erro && <p className="erro">{erro}</p>}

      <div className="tabela-rolagem">
        <table className="tabela">
          <thead>
            <tr>
              <th>Código</th>
              <th>Descrição</th>
              <th>Categoria</th>
              <th>Un</th>
              <th className="num">Preço</th>
              <th className="num">Estoque</th>
            </tr>
          </thead>
          <tbody ref={tabela}>
            {lista.map((p, i) => (
              <tr
                key={p.id}
                className={[i === selecionado && 'selecionada', !p.ativo && 'inativo'].filter(Boolean).join(' ')}
                onClick={() => setSelecionado(i)}
                onDoubleClick={() => setEditando(p)}
              >
                <td className="codigo">{p.ean ?? (p.codigoBalanca !== null ? `bal. ${p.codigoBalanca}` : '—')}</td>
                <td>
                  {p.descricao}
                  {!p.ativo && <span className="etiqueta">inativo</span>}
                  {promocaoAtiva(p, hojeLocal()) && <span className="etiqueta oferta">oferta</span>}
                  {p.atacadoQuantidade !== null && <span className="etiqueta">atacarejo</span>}
                </td>
                <td>{p.categoria ?? ''}</td>
                <td>{p.unidade}</td>
                <td className="num">{formatarMoeda(precoTabela(p, hojeLocal()).preco)}</td>
                <td className={`num ${noEstoqueMinimo(p) ? 'baixo' : ''}`}>
                  {quantidadeParaTexto(p.estoqueAtual, p.unidade)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lista.length === 0 && !erro && (
          <p className="vazio">
            {termo ? 'Nada encontrado.' : 'Nenhum produto ainda. F2 cadastra, F4 importa uma planilha.'}
          </p>
        )}
      </div>

      <p className="dica rodape-lista">
        <span>
          {lista.length} {lista.length === 1 ? 'produto' : 'produtos'}
        </span>
        ↑ ↓ escolhe · Enter edita · F2 novo · F4 importar · F6 etiquetas de gôndola · Esc volta
      </p>

      {editando !== null && (
        <FormProduto
          key={editando === 'novo' ? 'novo' : editando.id}
          produto={editando === 'novo' ? null : editando}
          onFechar={fecharForm}
          onAbrirExistente={(p) => setEditando(p)}
        />
      )}
      {etiquetas && <Etiquetas onFechar={() => setEtiquetas(false)} />}
      {importando && (
        <ImportarCsv
          onFechar={(importou) => {
            setImportando(false)
            if (importou) setRecarregar((n) => n + 1)
          }}
        />
      )}
    </main>
  )
}
