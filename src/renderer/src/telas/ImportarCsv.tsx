import { useState } from 'react'
import { formatarMoeda, quantidadeParaTexto } from '@shared/dinheiro'
import type { PreviaImportacao, ResultadoImportacao } from '@shared/produtos'
import { mensagemErro, useTeclas } from '../util'

type Etapa =
  | { tipo: 'escolher' }
  | { tipo: 'previa'; previa: PreviaImportacao }
  | { tipo: 'pronto'; resultado: ResultadoImportacao }

export function ImportarCsv({ onFechar }: { onFechar: (importou: boolean) => void }): React.JSX.Element {
  const [etapa, setEtapa] = useState<Etapa>({ tipo: 'escolher' })
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  async function executar(acao: () => Promise<void>): Promise<void> {
    if (ocupado) return
    setOcupado(true)
    setErro(null)
    try {
      await acao()
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setOcupado(false)
    }
  }

  const escolher = (): Promise<void> =>
    executar(async () => {
      const previa = await window.pdv.importacao.analisarCsv()
      if (previa) setEtapa({ tipo: 'previa', previa })
    })

  const salvarModelo = (): Promise<void> =>
    executar(async () => {
      if (await window.pdv.importacao.salvarModeloCsv()) setAviso('Modelo salvo. Preencha no Excel e importe.')
    })

  const confirmar = (): Promise<void> =>
    executar(async () => {
      if (etapa.tipo !== 'previa') return
      const resultado = await window.pdv.importacao.confirmarCsv(etapa.previa.id)
      setEtapa({ tipo: 'pronto', resultado })
    })

  const fechar = (): void => onFechar(etapa.tipo === 'pronto')

  useTeclas({
    Escape: fechar,
    Enter: () => {
      if (etapa.tipo === 'escolher') void escolher()
      else if (etapa.tipo === 'pronto') fechar()
    },
    F10: () => {
      if (etapa.tipo === 'previa') void confirmar()
    }
  })

  return (
    <div className="fundo-modal">
      <div className="modal modal-largo">
        <h2>Importar produtos de planilha (CSV)</h2>

        {etapa.tipo === 'escolher' && (
          <>
            <p>
              Colunas reconhecidas: <code>ean</code>, <code>descricao</code>, <code>unidade</code> (UN/KG),{' '}
              <code>preco_venda</code>, <code>preco_custo</code>, <code>categoria</code>, <code>estoque</code>,{' '}
              <code>estoque_minimo</code> e <code>codigo_balanca</code>. Só descrição e preço de venda são
              obrigatórios. Separador ; ou , e acentos do Excel funcionam.
            </p>
            <p>
              Produto que já existe (mesmo EAN, código de balança ou descrição) é atualizado apenas nas colunas
              preenchidas. O estoque dele não muda.
            </p>
            {aviso && <p className="aviso">{aviso}</p>}
            <div className="acoes">
              <button className="secundario" onClick={() => void salvarModelo()} disabled={ocupado}>
                Baixar modelo
              </button>
              <span className="espaco" />
              <button className="secundario" onClick={fechar}>
                <kbd>Esc</kbd> Fechar
              </button>
              <button className="primario" onClick={() => void escolher()} disabled={ocupado}>
                <kbd>Enter</kbd> Escolher arquivo
              </button>
            </div>
          </>
        )}

        {etapa.tipo === 'previa' && (
          <>
            <p>
              <strong>{etapa.previa.arquivo}</strong>: {etapa.previa.totalLinhas} linhas ·{' '}
              <strong>{etapa.previa.criar}</strong> novos · <strong>{etapa.previa.atualizar}</strong> atualizados ·{' '}
              <strong className={etapa.previa.erros.length ? 'erro' : ''}>{etapa.previa.erros.length}</strong> com
              erro
            </p>

            {etapa.previa.erros.length > 0 && (
              <div className="lista-erros">
                {etapa.previa.erros.slice(0, 200).map((e) => (
                  <div key={e.linha}>
                    Linha {e.linha}: {e.mensagem}
                  </div>
                ))}
                {etapa.previa.erros.length > 200 && <div>… e mais {etapa.previa.erros.length - 200}</div>}
              </div>
            )}

            {etapa.previa.amostra.length > 0 && (
              <div className="tabela-rolagem previa">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Linha</th>
                      <th>Ação</th>
                      <th>EAN</th>
                      <th>Descrição</th>
                      <th>Un</th>
                      <th className="num">Preço</th>
                      <th className="num">Estoque</th>
                    </tr>
                  </thead>
                  <tbody>
                    {etapa.previa.amostra.map((l) => (
                      <tr key={l.linha}>
                        <td>{l.linha}</td>
                        <td>{l.acao === 'criar' ? 'novo' : 'atualiza'}</td>
                        <td className="codigo">{l.entrada.ean ?? ''}</td>
                        <td>{l.entrada.descricao}</td>
                        <td>{l.entrada.unidade}</td>
                        <td className="num">{formatarMoeda(l.entrada.precoVenda)}</td>
                        <td className="num">{quantidadeParaTexto(l.entrada.estoqueAtual, l.entrada.unidade)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="acoes">
              <button className="secundario" onClick={() => void escolher()} disabled={ocupado}>
                Outro arquivo
              </button>
              <span className="espaco" />
              <button className="secundario" onClick={fechar}>
                <kbd>Esc</kbd> Cancelar
              </button>
              <button
                className="primario"
                onClick={() => void confirmar()}
                disabled={ocupado || etapa.previa.criar + etapa.previa.atualizar === 0}
              >
                <kbd>F10</kbd> Importar {etapa.previa.criar + etapa.previa.atualizar} produtos
              </button>
            </div>
          </>
        )}

        {etapa.tipo === 'pronto' && (
          <>
            <p className="aviso">
              Importação concluída: {etapa.resultado.criados} produtos novos e {etapa.resultado.atualizados}{' '}
              atualizados.
            </p>
            <div className="acoes">
              <span className="espaco" />
              <button className="primario" onClick={fechar}>
                <kbd>Enter</kbd> Fechar
              </button>
            </div>
          </>
        )}

        {erro && <p className="erro">{erro}</p>}
      </div>
    </div>
  )
}
