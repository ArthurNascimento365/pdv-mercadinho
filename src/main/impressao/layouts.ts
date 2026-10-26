import type { MovimentoCaixa, ResumoCaixa } from '@shared/caixa'
import { formatarMoeda, quantidadeParaTexto } from '@shared/dinheiro'
import type { Documento, LinhaDocumento } from '@shared/impressao'
import { FORMAS_PAGAMENTO, type Venda } from '@shared/vendas'

export interface ContextoLoja {
  nome: string
  /** Linhas extras do cabeçalho (CNPJ, endereço...), separadas por quebra de linha. */
  cabecalho: string
  rodape: string
}

const real = (c: number): string => formatarMoeda(c).replace(/ /g, ' ')
const valor = (c: number): string => real(c).replace(/^-?R\$ ?/, c < 0 ? '-' : '')

export function dataHora(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).replace(',', '')
}

function linhasDe(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

function cabecalho(loja: ContextoLoja): Documento {
  return [
    { tipo: 'texto', texto: loja.nome, alinhamento: 'centro', negrito: true, grande: true },
    ...linhasDe(loja.cabecalho).map((t): LinhaDocumento => ({ tipo: 'texto', texto: t, alinhamento: 'centro' })),
    { tipo: 'separador' }
  ]
}

export function cupomVenda(venda: Venda, loja: ContextoLoja, caixa: { id: number; operador: string } | null): Documento {
  const doc: Documento = [
    ...cabecalho(loja),
    { tipo: 'texto', texto: 'CUPOM NÃO FISCAL', alinhamento: 'centro', negrito: true },
    { tipo: 'texto', texto: 'NÃO É DOCUMENTO FISCAL', alinhamento: 'centro' },
    { tipo: 'separador' },
    { tipo: 'colunas', esquerda: `Venda nº ${venda.id}`, direita: dataHora(venda.finalizadaEm ?? venda.iniciadaEm) }
  ]
  if (caixa) doc.push({ tipo: 'texto', texto: `Caixa nº ${caixa.id} · ${caixa.operador}` })
  if (venda.status === 'cancelada') {
    doc.push({ tipo: 'texto', texto: '*** VENDA CANCELADA ***', alinhamento: 'centro', negrito: true })
  }
  doc.push({ tipo: 'separador' })

  // Item cancelado não sai no cupom do cliente (fica registrado no sistema).
  for (const i of venda.itens.filter((x) => !x.cancelado)) {
    const un = i.unidade === 'KG' ? 'kg' : 'un'
    doc.push(
      { tipo: 'texto', texto: `${String(i.sequencia).padStart(3, '0')} ${i.descricao}` },
      {
        tipo: 'colunas',
        esquerda: `    ${quantidadeParaTexto(i.quantidade, i.unidade)} ${un} x ${valor(i.precoUnitario)}${
          i.tipoPreco === 'promocao' ? ' promoção' : i.tipoPreco === 'atacado' ? ' atacado' : ''
        }`,
        direita: valor(i.totalBruto)
      }
    )
    if (i.desconto > 0) doc.push({ tipo: 'colunas', esquerda: '    desconto', direita: valor(-i.desconto) })
  }

  doc.push({ tipo: 'separador' })
  if (venda.desconto > 0) {
    doc.push(
      { tipo: 'colunas', esquerda: 'Subtotal', direita: valor(venda.subtotal) },
      { tipo: 'colunas', esquerda: 'Desconto', direita: valor(-venda.desconto) }
    )
  }
  doc.push({ tipo: 'colunas', esquerda: 'TOTAL', direita: real(venda.total), negrito: true, grande: true })
  for (const p of venda.pagamentos) {
    doc.push({ tipo: 'colunas', esquerda: FORMAS_PAGAMENTO[p.forma], direita: valor(p.valor) })
  }
  // Pagamento dividido ou com troco: a soma das formas, para o cliente conferir sem fazer conta.
  if (venda.pagamentos.length > 1 || venda.troco > 0) {
    doc.push({ tipo: 'colunas', esquerda: 'Total recebido', direita: valor(venda.pago), negrito: true })
  }
  if (venda.troco > 0) doc.push({ tipo: 'colunas', esquerda: 'Troco', direita: valor(venda.troco), negrito: true })

  const itens = venda.itens.filter((x) => !x.cancelado).length
  doc.push({ tipo: 'texto', texto: `${itens} ${itens === 1 ? 'item' : 'itens'}` }, { tipo: 'separador' })
  for (const t of linhasDe(loja.rodape)) doc.push({ tipo: 'texto', texto: t, alinhamento: 'centro' })
  return doc
}

/** Comprovante de sangria/suprimento, com linha para assinatura de quem retirou. */
export function comprovanteMovimento(movimento: MovimentoCaixa, caixa: ResumoCaixa, loja: ContextoLoja): Documento {
  return [
    ...cabecalho(loja),
    {
      tipo: 'texto',
      texto: movimento.tipo === 'sangria' ? 'SANGRIA DE CAIXA' : 'SUPRIMENTO DE CAIXA',
      alinhamento: 'centro',
      negrito: true
    },
    { tipo: 'colunas', esquerda: `Caixa nº ${caixa.id} · ${caixa.operador}`, direita: dataHora(movimento.criadoEm) },
    { tipo: 'separador' },
    { tipo: 'colunas', esquerda: 'VALOR', direita: real(movimento.valor), negrito: true, grande: true },
    ...(movimento.motivo ? [{ tipo: 'texto', texto: `Motivo: ${movimento.motivo}` } as LinhaDocumento] : []),
    { tipo: 'espaco' },
    { tipo: 'espaco' },
    { tipo: 'separador', caractere: '_' },
    { tipo: 'texto', texto: 'Assinatura', alinhamento: 'centro' }
  ]
}

/** Relatório de fechamento: esperado × contado por forma. */
export function relatorioFechamento(caixa: ResumoCaixa, loja: ContextoLoja): Documento {
  const doc: Documento = [
    ...cabecalho(loja),
    { tipo: 'texto', texto: `FECHAMENTO DO CAIXA Nº ${caixa.id}`, alinhamento: 'centro', negrito: true },
    { tipo: 'texto', texto: `Operador: ${caixa.operador}` },
    { tipo: 'texto', texto: `Aberto:  ${dataHora(caixa.abertoEm)}` },
    { tipo: 'texto', texto: `Fechado: ${dataHora(caixa.fechadoEm)}` },
    { tipo: 'separador' },
    { tipo: 'colunas', esquerda: 'Vendas', direita: String(caixa.vendas.quantidade) },
    { tipo: 'colunas', esquerda: 'Canceladas', direita: String(caixa.vendas.canceladas) },
    { tipo: 'colunas', esquerda: 'Total vendido', direita: valor(caixa.vendas.total), negrito: true },
    { tipo: 'separador' },
    { tipo: 'colunas', esquerda: 'Fundo de troco', direita: valor(caixa.fundoTroco) },
    { tipo: 'colunas', esquerda: 'Recebido em dinheiro', direita: valor(caixa.recebido.dinheiro) },
    ...(caixa.recebimentosFiado > 0
      ? [{ tipo: 'colunas', esquerda: '  (inclui pagamentos de fiado)', direita: valor(caixa.recebimentosFiado) } as LinhaDocumento]
      : []),
    ...(caixa.vendidoFiado > 0
      ? [{ tipo: 'colunas', esquerda: 'Vendido no fiado', direita: valor(caixa.vendidoFiado) } as LinhaDocumento]
      : []),
    { tipo: 'colunas', esquerda: 'Suprimentos', direita: valor(caixa.suprimentos) },
    { tipo: 'colunas', esquerda: 'Sangrias', direita: valor(-caixa.sangrias) },
    { tipo: 'separador' },
    { tipo: 'colunas', esquerda: 'FORMA   esperado / contado', direita: 'diferença' }
  ]
  let total = 0
  for (const l of caixa.fechamento ?? []) {
    total += l.diferenca
    doc.push(
      { tipo: 'texto', texto: FORMAS_PAGAMENTO[l.forma], negrito: true },
      { tipo: 'colunas', esquerda: `  ${valor(l.esperado)} / ${valor(l.contado)}`, direita: valor(l.diferenca) }
    )
  }
  doc.push(
    { tipo: 'separador' },
    {
      tipo: 'colunas',
      esquerda: total < 0 ? 'FALTA' : total > 0 ? 'SOBRA' : 'DIFERENÇA',
      direita: real(Math.abs(total)),
      negrito: true
    }
  )
  if (caixa.observacao) doc.push({ tipo: 'texto', texto: `Obs.: ${caixa.observacao}` })
  doc.push(
    { tipo: 'espaco' },
    { tipo: 'espaco' },
    { tipo: 'separador', caractere: '_' },
    { tipo: 'texto', texto: 'Operador', alinhamento: 'centro' }
  )
  return doc
}

/** Via do estabelecimento da compra no fiado: o cliente assina. */
export function comprovanteCompraFiado(
  venda: Venda,
  cliente: { nome: string; saldo: number },
  loja: ContextoLoja
): Documento {
  const fiado = venda.pagamentos.filter((p) => p.forma === 'fiado').reduce((s, p) => s + p.valor, 0)
  return [
    ...cabecalho(loja),
    { tipo: 'texto', texto: 'COMPRA NO FIADO', alinhamento: 'centro', negrito: true },
    { tipo: 'texto', texto: 'via do estabelecimento', alinhamento: 'centro' },
    { tipo: 'colunas', esquerda: `Venda nº ${venda.id}`, direita: dataHora(venda.finalizadaEm) },
    { tipo: 'texto', texto: `Cliente: ${cliente.nome}`, negrito: true },
    { tipo: 'separador' },
    { tipo: 'colunas', esquerda: 'Total da compra', direita: valor(venda.total) },
    { tipo: 'colunas', esquerda: 'NO FIADO', direita: real(fiado), negrito: true, grande: true },
    { tipo: 'colunas', esquerda: 'Saldo devedor agora', direita: real(cliente.saldo), negrito: true },
    { tipo: 'espaco' },
    { tipo: 'texto', texto: 'Reconheço a dívida acima.' },
    { tipo: 'espaco' },
    { tipo: 'espaco' },
    { tipo: 'separador', caractere: '_' },
    { tipo: 'texto', texto: cliente.nome, alinhamento: 'centro' }
  ]
}

export function comprovanteRecebimentoFiado(
  r: { cliente: string; valor: number; forma: string; saldo: number; data: string; caixa: { id: number; operador: string } | null },
  loja: ContextoLoja
): Documento {
  return [
    ...cabecalho(loja),
    { tipo: 'texto', texto: 'RECIBO DE PAGAMENTO - FIADO', alinhamento: 'centro', negrito: true },
    { tipo: 'colunas', esquerda: r.caixa ? `Caixa nº ${r.caixa.id} · ${r.caixa.operador}` : '', direita: dataHora(r.data) },
    { tipo: 'texto', texto: `Cliente: ${r.cliente}`, negrito: true },
    { tipo: 'separador' },
    { tipo: 'colunas', esquerda: 'VALOR PAGO', direita: real(r.valor), negrito: true, grande: true },
    { tipo: 'colunas', esquerda: 'Forma', direita: r.forma },
    {
      tipo: 'colunas',
      esquerda: r.saldo > 0 ? 'Ainda deve' : 'Saldo',
      direita: r.saldo > 0 ? real(r.saldo) : 'QUITADO',
      negrito: true
    },
    { tipo: 'espaco' },
    { tipo: 'espaco' },
    { tipo: 'separador', caractere: '_' },
    { tipo: 'texto', texto: 'Recebido por', alinhamento: 'centro' }
  ]
}

/** Papel com o QR do Pix para o cliente pagar antes de finalizar a venda. */
export function cobrancaPix(
  p: { valor: number; vendaId: number | null; payload: string; chave: string },
  loja: ContextoLoja
): Documento {
  return [
    ...cabecalho(loja),
    { tipo: 'texto', texto: 'PAGUE COM PIX', alinhamento: 'centro', negrito: true },
    ...(p.vendaId ? [{ tipo: 'texto', texto: `Venda nº ${p.vendaId}`, alinhamento: 'centro' } as LinhaDocumento] : []),
    { tipo: 'texto', texto: real(p.valor), alinhamento: 'centro', negrito: true, grande: true },
    { tipo: 'qrcode', conteudo: p.payload },
    { tipo: 'texto', texto: `Chave: ${p.chave}`, alinhamento: 'centro' },
    { tipo: 'texto', texto: 'Mostre o comprovante ao caixa.', alinhamento: 'centro' }
  ]
}

export function paginaTeste(loja: ContextoLoja, colunas: number): Documento {
  return [
    ...cabecalho(loja),
    { tipo: 'texto', texto: 'TESTE DE IMPRESSÃO', alinhamento: 'centro', negrito: true },
    { tipo: 'texto', texto: dataHora(new Date().toISOString()), alinhamento: 'centro' },
    { tipo: 'separador' },
    { tipo: 'texto', texto: 'Acentos: ÁÉÍÓÚ áéíóú ÂÊÔ âêô ÃÕ ãõ Çç ºª' },
    { tipo: 'texto', texto: `Régua (${colunas} colunas):` },
    { tipo: 'texto', texto: '1234567890'.repeat(Math.ceil(colunas / 10)).slice(0, colunas) },
    { tipo: 'colunas', esquerda: 'Esquerda', direita: 'direita' },
    { tipo: 'texto', texto: 'Negrito', negrito: true },
    { tipo: 'texto', texto: 'Grande', grande: true, alinhamento: 'centro' },
    { tipo: 'separador' },
    { tipo: 'texto', texto: 'Se os acentos saíram errados, troque a tabela de caracteres nas Configurações.' }
  ]
}
