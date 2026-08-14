'use strict';

function normalizar(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function limparEnunciadoIA(texto) {
  return String(texto || '')
    .replace(/\*\*/g, '')
    .replace(/^\s*#*\s*CASO\b\s*:?\s*/i, '')
    .replace(/^\s*<enunciado>\s*/i, '')
    .replace(/\s*<\/enunciado>\s*$/i, '')
    .trim();
}

function limparGabaritoIA(texto) {
  const t = String(texto || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(linha => {
      const n = normalizar(linha);
      return !n.includes('auditoria deveria ter normalizado')
        && !(n.includes('o texto nao indica o tribunal') && n.includes('corrija o texto'));
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const inicio = t.search(/^\s*##\s+/m);
  return inicio >= 0 ? t.slice(inicio).trim() : t;
}

function limparCorrecaoIA(texto) {
  const t = String(texto || '').replace(/\r\n/g, '\n').trim();
  const inicio = t.search(/^\s*##\s+Acertos\b/im);
  const limpo = inicio >= 0 ? t.slice(inicio).trim() : t;
  return limpo.replace(/\n```(?:markdown)?\s*$/i, '').trim();
}

function formatarNota(valor) {
  return Math.max(0, Number(valor) || 0).toFixed(2).replace('.', ',');
}

function contemTrechoExtensoCopiado(relatorio, respostaAluno, quantidade) {
  const tamanho = Math.max(12, Number(quantidade) || 18);
  const tokens = valor => normalizar(valor).match(/[a-z0-9]+/g) || [];
  const origem = tokens(respostaAluno);
  const destino = tokens(relatorio);
  if (origem.length < tamanho || destino.length < tamanho) return false;
  const sequencias = new Set();
  for (let i = 0; i <= origem.length - tamanho; i++) sequencias.add(origem.slice(i, i + tamanho).join(' '));
  for (let i = 0; i <= destino.length - tamanho; i++) if (sequencias.has(destino.slice(i, i + tamanho).join(' '))) return true;
  return false;
}

function linhasSoltasEmLista(texto, titulo) {
  return secao(texto, titulo).split(/\r?\n/).slice(1).filter(linha => {
    const l = linha.trim();
    return l && !/^[-*+]\s+/.test(l) && !/^\d+[.)]\s+/.test(l);
  });
}

function paresPontuacao(bloco) {
  const itens = [];
  for (const linha of String(bloco || '').split(/\r?\n/)) {
    if (!linha.trim().startsWith('|') || /^\s*\|?\s*[-:| ]+\|?\s*$/.test(linha)) continue;
    const candidatos = Array.from(linha.matchAll(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/g))
      .map(m => ({ match: m[0], obtido: numeroBR(m[1]), maximo: numeroBR(m[2]) }))
      .filter(p => p.obtido != null && p.maximo != null && p.obtido >= 0 && p.maximo > 0 && p.obtido <= p.maximo && p.maximo <= 5);
    const par = candidatos[candidatos.length - 1];
    if (!par) continue;
    const celulas = linha.slice(1, linha.endsWith('|') ? -1 : undefined).split('|').map(c => c.replace(/[*_`]/g, '').trim());
    const indiceNota = celulas.findIndex(c => c.includes(par.match));
    const rotulos = celulas.slice(0, indiceNota < 0 ? 1 : indiceNota).map(normalizar);
    if (rotulos.some(c => /^(?:total|subtotal|soma|pontuacao final|nota final)(?:\b|\s*:)/.test(c))) continue;
    const criterio = celulas.slice(0, indiceNota < 0 ? 1 : indiceNota).filter(c => c && !/^\d+$/.test(c) && !/^(?:item|crit[eé]rio avaliado)$/i.test(c)).join(' — ') || 'Critério avaliado';
    itens.push({ criterio: criterio.replace(/\|/g, '/'), obtido: par.obtido, maximo: par.maximo });
  }
  return itens;
}

function falhasFormatacaoNpj(auditoria) {
  const verificacoes = auditoria && Array.isArray(auditoria.verificacoes) ? auditoria.verificacoes : [];
  return verificacoes.filter(v => v && v.status === 'nao_conforme' && Number(v.desconto) > 0).map(v => ({
    rotulo: String(v.rotulo || v.codigo || 'Regra de formatação NPJ').replace(/\|/g, '/'),
    detalhe: String(v.detalhe || 'Descumprimento confirmado na auditoria do arquivo.').replace(/\|/g, '/'),
    desconto: Math.max(0, Number(v.desconto) || 0)
  }));
}

function normalizarPenalidadesCorrecao(texto, auditoriaFormatacao) {
  const original = limparCorrecaoIA(texto);
  const itens = paresPontuacao(secao(original, 'pontuacao item a item'));
  const subtotal = Math.round(itens.reduce((s, item) => s + item.obtido, 0) * 100) / 100;
  const blocoRobotizacao = secao(original, 'verificacao de robotizacao e supervisao humana');
  const riscoMatch = blocoRobotizacao.match(/\brisco\s*:?\s*(BAIXO|ATEN[CÇ][AÃ]O|ALTO)\b/i);
  const risco = riscoMatch ? normalizar(riscoMatch[1]) : 'baixo';
  const penalidadeRobotizacao = risco === 'alto' ? 1 : risco === 'atencao' ? 0.5 : 0;
  const blocoJurisprudencia = secao(original, 'verificacao de jurisprudencia e citacoes');
  const ocorrenciasDuvidosas = blocoJurisprudencia.split(/\r?\n/).filter(l => /\b(?:SUSPEITA|N[AÃ]O\s+CONFIRMADA)\b/i.test(l)).length;
  const penalidadeJurisprudencia = Math.min(1, ocorrenciasDuvidosas * 0.25);
  const outrasMatch = original.match(/OUTRAS\s+PENALIDADES\s+FORA\s+DO\s+ESPELHO\s*:\s*-?\s*(\d+(?:[.,]\d+)?)/i);
  const outrasPenalidades = Math.min(5, Math.max(0, outrasMatch ? numeroBR(outrasMatch[1]) || 0 : 0));
  const falhasFormatacao = falhasFormatacaoNpj(auditoriaFormatacao);
  const penalidadeFormatacaoNpj = Math.min(0.60, Math.round(falhasFormatacao.reduce((s, item) => s + item.desconto, 0) * 100) / 100);
  const totalPenalidades = Math.round((penalidadeRobotizacao + penalidadeJurisprudencia + penalidadeFormatacaoNpj + outrasPenalidades) * 100) / 100;
  const citacaoFalsa = /(?:—|:)\s*INEXISTENTE(?:\/FALSA)?|CITA[CÇ][AÃ]O FALSA DETECTADA/i.test(original);
  const nota = citacaoFalsa ? 0 : Math.min(5, Math.max(0, Math.round((subtotal - totalPenalidades) * 100) / 100));

  const linhas = original.split(/\r?\n/);
  const semRastreabilidade = [];
  let ignorandoRastreabilidade = false;
  for (const linha of linhas) {
    if (/^\s*##\s+.*rastreabilidade\s+dos\s+descontos/i.test(normalizar(linha))) { ignorandoRastreabilidade = true; continue; }
    if (ignorandoRastreabilidade && /^\s*##\s+/.test(linha)) ignorandoRastreabilidade = false;
    if (ignorandoRastreabilidade) continue;
    if (/^\s*(?:PENALIDADE\s+POR\s+ROBOTIZA[CÇ][AÃ]O|PENALIDADE\s+POR\s+JURISPRUD[EÊ]NCIA\s+N[AÃ]O\s+CONFIRMADA|PENALIDADE\s+POR\s+FORMATA[CÇ][AÃ]O\s+NPJ|OUTRAS\s+PENALIDADES\s+FORA\s+DO\s+ESPELHO|TOTAL\s+DE\s+PENALIDADES\s+FORA\s+DO\s+ESPELHO|NOTA\s+SUGERIDA)\s*:/i.test(linha)) continue;
    semRastreabilidade.push(linha);
  }

  const indiceRobotizacao = semRastreabilidade.findIndex(l => /^\s*##\s+/.test(l) && normalizar(l).includes('verificacao de robotizacao e supervisao humana'));
  if (indiceRobotizacao >= 0) {
    let fim = semRastreabilidade.length;
    for (let i = indiceRobotizacao + 1; i < semRastreabilidade.length; i++) if (/^\s*##\s+/.test(semRastreabilidade[i])) { fim = i; break; }
    semRastreabilidade.splice(fim, 0, 'PENALIDADE POR ROBOTIZAÇÃO: ' + (penalidadeRobotizacao ? '-' : '') + formatarNota(penalidadeRobotizacao));
  }

  const rastreabilidade = ['## Rastreabilidade dos descontos', '| Falha identificada | Aplicação | Desconto |', '|---|---|---:|'];
  for (const item of itens) {
    const perda = Math.round((item.maximo - item.obtido) * 100) / 100;
    if (perda > 0.001) rastreabilidade.push('| ' + item.criterio + ' | Desconto aplicado no próprio item do espelho | ' + formatarNota(perda) + ' |');
  }
  if (penalidadeRobotizacao) rastreabilidade.push('| Indícios concretos de robotização — risco ' + risco.toUpperCase() + ' | Penalidade fora do espelho | ' + formatarNota(penalidadeRobotizacao) + ' |');
  if (penalidadeJurisprudencia) rastreabilidade.push('| Jurisprudência suspeita ou não confirmada (' + ocorrenciasDuvidosas + ' ocorrência(s)) | Penalidade fora do espelho | ' + formatarNota(penalidadeJurisprudencia) + ' |');
  for (const falha of falhasFormatacao) rastreabilidade.push('| ' + falha.rotulo + ': ' + falha.detalhe + ' | Penalidade objetiva de formatação NPJ, fora do espelho e sem duplicidade | ' + formatarNota(falha.desconto) + ' |');
  if (outrasPenalidades) rastreabilidade.push('| Outras falhas não abrangidas pelo espelho | Penalidade fora do espelho | ' + formatarNota(outrasPenalidades) + ' |');
  if (rastreabilidade.length === 3) rastreabilidade.push('| Nenhuma falha com desconto | Sem penalidade | 0,00 |');
  rastreabilidade.push('PENALIDADE POR JURISPRUDÊNCIA NÃO CONFIRMADA: ' + (penalidadeJurisprudencia ? '-' : '') + formatarNota(penalidadeJurisprudencia));
  rastreabilidade.push('PENALIDADE POR FORMATAÇÃO NPJ: ' + (penalidadeFormatacaoNpj ? '-' : '') + formatarNota(penalidadeFormatacaoNpj));
  rastreabilidade.push('OUTRAS PENALIDADES FORA DO ESPELHO: ' + (outrasPenalidades ? '-' : '') + formatarNota(outrasPenalidades));
  rastreabilidade.push('TOTAL DE PENALIDADES FORA DO ESPELHO: ' + (totalPenalidades ? '-' : '') + formatarNota(totalPenalidades));
  rastreabilidade.push('NOTA SUGERIDA: ' + formatarNota(nota) + '/5');

  let inserirAntes = semRastreabilidade.findIndex(l => /^\s*##\s+/.test(l) && normalizar(l).includes('propostas de aprimoramento'));
  if (inserirAntes < 0) inserirAntes = semRastreabilidade.length;
  const verificacoesFormatacao = auditoriaFormatacao && Array.isArray(auditoriaFormatacao.verificacoes) ? auditoriaFormatacao.verificacoes : [];
  const secaoFormatacao = [];
  if (verificacoesFormatacao.length) {
    secaoFormatacao.push('## Verificação da formatação NPJ');
    for (const item of verificacoesFormatacao) {
      const estado = item.status === 'conforme' ? 'CONFORME' : item.status === 'nao_conforme' ? 'NÃO CONFORME' : 'NÃO VERIFICÁVEL — sem desconto';
      secaoFormatacao.push('- **' + estado + ' — ' + String(item.rotulo || item.codigo || 'Regra formal').replace(/[\r\n]+/g, ' ') + ':** ' + String(item.detalhe || '').replace(/[\r\n]+/g, ' '));
    }
    secaoFormatacao.push('- **Penalidade objetiva de formatação NPJ:** ' + (penalidadeFormatacaoNpj ? '-' : '') + formatarNota(penalidadeFormatacaoNpj) + '. Itens não verificáveis não foram penalizados.');
    secaoFormatacao.push('');
  }
  semRastreabilidade.splice(inserirAntes, 0, ...secaoFormatacao, ...rastreabilidade, '');
  return semRastreabilidade.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizarGabaritoPenal(texto) {
  return limparGabaritoIA(texto)
    .replace(/\bdias úteis\b/gi, 'dias corridos')
    .replace(/cont[ií]nuo,\s*e\s*n[aã]o\s*em\s*dias\s*corridos/gi, 'contínuo, em dias corridos')
    .replace(/art\.\s*564,\s*IV\s*e\s*V(?:,\s*do\s+CPP|,\s*CPP|\s+do\s+CPP)?/gi, 'art. 563 do CPP');
}

function resultado(erros, detalhes) {
  return { ok: erros.length === 0, erros, detalhes: detalhes || {} };
}

function validarEnunciado(texto, nomePeca) {
  const t = String(texto || '').trim();
  const n = normalizar(t);
  const peca = normalizar(nomePeca);
  const erros = [];
  if (/<\/?enunciado>/i.test(t)) erros.push('O enunciado contém marcação interna da IA.');
  if (t.length < 300) erros.push('O enunciado está curto demais.');
  if (t.length > 20000) erros.push('O enunciado ultrapassa 20.000 caracteres.');
  if (!/na\s+condi[cç][aã]o\s+de\s+advogad[oa]\s*\(?a?\)?/i.test(t)) erros.push('Falta o comando final iniciado por “Na condição de advogado(a) de...”.');
  if (!/valor\s*:\s*5[,.]00/i.test(t)) erros.push('Falta a indicação “Valor: 5,00”.');
  const datasNumericas = t.match(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{4}\b/g) || [];
  const datasExtenso = t.match(/\b\d{1,2}\s+de\s+[a-zç]+\s+de\s+\d{4}\b/gi) || [];
  if (datasNumericas.length + datasExtenso.length < 2) erros.push('O caso precisa de ao menos duas datas completas para permitir a conferência da cronologia e do prazo.');
  if (/\b\d[\d.\/-]*(?:installer|undefined|null|nan|error)[\w.\/-]*/i.test(t) || /\bnot\b/i.test(t)) erros.push('O enunciado contém identificador corrompido ou fragmento textual incompatível com o português.');
  const exigeNumeroCnj = peca !== 'queixa-crime' && peca !== 'queixa crime';
  if (exigeNumeroCnj && !/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/.test(t)) erros.push('Falta um número fictício de processo no padrão CNJ válido.');
  if (/^\s*#{1,3}\s*(gabarito|espelho|resposta)/im.test(t) || n.includes('## espelho de correcao')) erros.push('A resposta contém conteúdo de gabarito, não apenas o enunciado.');
  return resultado(erros, { tamanho: t.length });
}

function secao(texto, titulo) {
  const linhas = String(texto || '').split(/\r?\n/);
  const alvo = normalizar(titulo);
  const inicio = linhas.findIndex(l => /^\s*##\s+/.test(l) && normalizar(l).includes(alvo));
  if (inicio < 0) return '';
  let fim = linhas.length;
  for (let i = inicio + 1; i < linhas.length; i++) if (/^\s*##\s+/.test(linhas[i])) { fim = i; break; }
  return linhas.slice(inicio, fim).join('\n');
}

function numeroBR(valor) {
  const s = String(valor || '').trim();
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
}

function valorPontuacao(celula) {
  const texto = String(celula || '').replace(/[*_`]/g, '').trim();
  const tokens = texto.match(/\d+(?:[.,]\d+)?/g) || [];
  const valores = tokens.map(numeroBR).filter(v => v != null);
  if (!valores.length) return null;

  // A IA às vezes escreve a decomposição na própria célula, por exemplo:
  // "0,60 (0,40 pela tese + 0,20 pelo dispositivo)". Nesse formato, o
  // primeiro número já é o total da linha; somar todos triplicaria a nota.
  if (valores.length > 1) {
    const restante = valores.slice(1).reduce((s, v) => s + v, 0);
    if (Math.abs(valores[0] - restante) <= 0.011) return valores[0];
  }

  // Também aceitamos fórmulas explícitas: "0,40 + 0,20 = 0,60".
  const depoisIgual = texto.match(/=\s*(\d+(?:[.,]\d+)?)/);
  if (depoisIgual) return numeroBR(depoisIgual[1]);
  if (/\+/.test(texto)) return Math.round(valores.reduce((s, v) => s + v, 0) * 100) / 100;
  if (valores.length > 1 && /tese|fundament|dispositivo|artigo/i.test(texto)) {
    return Math.round(valores.reduce((s, v) => s + v, 0) * 100) / 100;
  }
  return valores[0];
}

function analisarEspelho(texto) {
  const bloco = secao(texto, 'espelho de correcao');
  const linhas = bloco.split(/\r?\n/).filter(l => l.includes('|'));
  let soma = 0, total = null, itens = 0;
  for (const linha of linhas) {
    if (/^\s*\|?\s*:?-{2,}/.test(linha) || /pontua[cç][aã]o/i.test(linha) && /item/i.test(linha)) continue;
    const celulas = linha.split('|').map(c => c.replace(/[*_`]/g, '').trim()).filter(Boolean);
    if (celulas.length < 2) continue;
    const rotulo = normalizar(celulas[0]);
    const valor = valorPontuacao(celulas[celulas.length - 1]);
    if (valor == null) continue;
    if (rotulo.includes('total')) total = valor;
    else { soma += valor; itens++; }
  }
  if (total == null) {
    const m = bloco.match(/total[^\d]{0,20}(\d+(?:[.,]\d+)?)/i);
    if (m) total = numeroBR(m[1]);
  }
  return { bloco, itens, soma: Math.round(soma * 100) / 100, total };
}

function normalizarEspelhoCinco(texto) {
  const linhas = String(texto || '').split(/\r?\n/);
  const inicio = linhas.findIndex(l => /^\s*##\s+/.test(l) && normalizar(l).includes('espelho de correcao'));
  if (inicio < 0) return String(texto || '');
  let fim = linhas.length;
  for (let i = inicio + 1; i < linhas.length; i++) {
    if (/^\s*##\s+/.test(linhas[i])) { fim = i; break; }
  }
  const itens = [];
  let total = null;
  for (let i = inicio + 1; i < fim; i++) {
    if (!linhas[i].includes('|') || /^\s*\|?\s*:?-{2,}/.test(linhas[i])) continue;
    const partes = linhas[i].split('|');
    const preenchidas = partes.map((p, indice) => p.trim() ? indice : -1).filter(indice => indice >= 0);
    if (preenchidas.length < 2) continue;
    const rotulo = normalizar(partes[preenchidas[0]]);
    if (/pontuacao/.test(rotulo) && /item/.test(rotulo)) continue;
    const indiceNota = preenchidas[preenchidas.length - 1];
    const valor = valorPontuacao(partes[indiceNota]);
    if (valor == null) continue;
    const registro = { linha: i, partes, indiceNota, valor };
    if (rotulo.includes('total')) total = registro;
    else itens.push(registro);
  }
  if (!itens.length) return String(texto || '');
  for (const item of itens) item.valor = Math.round(item.valor * 20) / 20;
  const soma = Math.round(itens.reduce((s, item) => s + item.valor, 0) * 100) / 100;
  const diferenca = Math.round((5 - soma) * 100) / 100;
  if (Math.abs(diferenca) > 0.001) {
    const alvo = itens.reduce((maior, item) => item.valor > maior.valor ? item : maior, itens[0]);
    const novoValor = Math.round((alvo.valor + diferenca) * 100) / 100;
    if (novoValor < 0) return String(texto || '');
    alvo.valor = novoValor;
  }
  for (const item of itens) {
    item.partes[item.indiceNota] = ' ' + item.valor.toFixed(2).replace('.', ',') + ' ';
    linhas[item.linha] = item.partes.join('|');
  }
  if (total) {
    total.partes[total.indiceNota] = ' **5,00** ';
    linhas[total.linha] = total.partes.join('|');
  } else {
    linhas.splice(fim, 0, '| **Total** | **5,00** |');
  }
  return linhas.join('\n');
}

function nomeCompativel(bloco, nomePeca) {
  if (!nomePeca) return true;
  const a = normalizar(bloco);
  const b = normalizar(nomePeca);
  if (a.includes(b)) return true;
  const palavras = b.split(/[^a-z0-9]+/).filter(x => x.length >= 4 && !['peca', 'penal', 'processo'].includes(x));
  return palavras.length > 0 && palavras.filter(x => a.includes(x)).length / palavras.length >= 0.7;
}

function detectarJurisprudencia(texto) {
  return /\bs[uú]mula\b|\btema\s+\d+|\b(?:REsp|AREsp|EREsp|AgRg|AgInt|RMS|RHC|HC|RE|ARE|ADI|ADC|ADPF|APn|CC)\s*(?:n[ºo°.]?\s*)?[\d.]+|\bac[oó]rd[aã]o\b|\bjurisprud[eê]ncia\b|\brepetitivo\b/i.test(String(texto || ''));
}

const TERMOS_NARRATIVOS_COMUNS = new Set(('advogado advogada autos brasilia cabivel caso criminal defesa delito direito distrito elaborar enunciado fatos fundamento juizo medida penal peca processo processual requerido sentenca valor vedado').split(' '));
function tokensNarrativa(texto) {
  const corpo = normalizar(texto).split(/na\s+condicao\s+de\s+advogad[oa]/)[0].replace(/\d+/g, ' ');
  return corpo.split(/[^a-z]+/).filter(p => p.length >= 4 && !TERMOS_NARRATIVOS_COMUNS.has(p));
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const item of a) if (b.has(item)) inter++;
  return inter / (a.size + b.size - inter);
}
function similaridadeNarrativa(a, b) {
  const ta = tokensNarrativa(a), tb = tokensNarrativa(b);
  const palavras = jaccard(new Set(ta), new Set(tb));
  const pares = tokens => new Set(tokens.slice(0, -1).map((t, i) => t + ' ' + tokens[i + 1]));
  const sequencia = jaccard(pares(ta), pares(tb));
  return Math.round((palavras * 0.7 + sequencia * 0.3) * 1000) / 1000;
}

function validarGabarito(texto, nomePeca) {
  const t = String(texto || '').trim();
  const erros = [];
  const obrigatorias = ['peca cabivel', 'enderecamento', 'prazo', 'teses', 'pedidos', 'estrutura da peca', 'espelho de correcao', 'erros frequentes', 'fontes'];
  const n = normalizar(t);
  if (!/^\s*##\s+/.test(t)) erros.push('O gabarito deve iniciar diretamente pela primeira seção, sem comentários da IA.');
  if (/\bdias úteis\b/i.test(t)) erros.push('Prazos processuais penais não devem ser apresentados como dias úteis.');
  if (/cont[ií]nuo,\s*e\s*n[aã]o\s*em\s*dias\s*corridos/i.test(t)) erros.push('A descrição do prazo penal está contraditória.');
  if (/art\.\s*564,\s*IV\s*e\s*V/i.test(t)) erros.push('O gabarito cita inciso inexistente do art. 564 do CPP.');
  const sumulaSemTribunal = /\bS[úu]mulas?\s+(?:n[ºo°.]?\s*)?\d+(?:\s*(?:,|e)\s*\d+)*\b(?!\s*(?:do|da|\/)\s*(?:STF|STJ)\b)/i.test(t);
  if (sumulaSemTribunal) erros.push('Toda súmula deve indicar expressamente STF ou STJ. Corrija a referência antes de importar ou publicar.');
  for (const titulo of obrigatorias) if (!new RegExp('^\\s*##\\s+.*' + titulo.replace(/ /g, '.*'), 'mi').test(n)) erros.push('Falta a seção “' + titulo + '”.');
  const espelho = analisarEspelho(t);
  if (!espelho.bloco) erros.push('O espelho de correção não foi encontrado.');
  else {
    if (espelho.itens < 3) erros.push('O espelho precisa ter ao menos três itens pontuados.');
    if (Math.abs(espelho.soma - 5) > 0.01) erros.push('A soma dos itens do espelho é ' + espelho.soma.toFixed(2).replace('.', ',') + ', e não 5,00.');
    if (espelho.total == null || Math.abs(espelho.total - 5) > 0.01) erros.push('A linha Total do espelho precisa declarar 5,00.');
  }
  if (!nomeCompativel(secao(t, 'peca cabivel'), nomePeca)) erros.push('A peça indicada no gabarito não corresponde à peça-alvo selecionada.');
  if (!/https:\/\/(?:www\.)?(?:planalto\.gov\.br|stf\.jus\.br|stj\.jus\.br|tjdft\.jus\.br|jurisprudencia\.stf\.jus\.br|scon\.stj\.jus\.br)/i.test(secao(t, 'fontes'))) erros.push('A seção Fontes não contém link oficial reconhecido.');
  return resultado(erros, espelho);
}

function validarCorrecao(texto, respostaAluno) {
  const t = String(texto || '').trim();
  const n = normalizar(t);
  const erros = [];
  const obrigatorias = ['acertos', 'erros formais', 'erros materiais', 'pontuacao item a item', 'verificacao de jurisprudencia e citacoes', 'verificacao de robotizacao e supervisao humana', 'rastreabilidade dos descontos', 'propostas de aprimoramento', 'fontes e links'];
  for (const titulo of obrigatorias) if (!new RegExp('^\\s*##\\s+.*' + titulo.replace(/ /g, '.*'), 'mi').test(n)) erros.push('Falta a seção “' + titulo + '”.');
  for (const titulo of ['acertos', 'erros formais', 'erros materiais']) {
    if (linhasSoltasEmLista(t, titulo).length) erros.push('A seção “' + titulo + '” contém parágrafo solto ou trecho da peça do aluno. Cada observação deve ser uma frase avaliativa completa em um item de lista, sem transcrição literal extensa.');
  }
  if (respostaAluno && contemTrechoExtensoCopiado(t, respostaAluno, 18)) erros.push('O relatório reproduz um trecho extenso da peça do aluno. Parafraseie apenas o ponto necessário e mantenha a análise em linguagem avaliativa.');
  const notas = Array.from(t.matchAll(/NOTA\s+SUGERIDA\s*:\s*(\d+(?:[.,]\d+)?)\s*\/\s*5/gi));
  if (notas.length !== 1) erros.push('A correção precisa conter exatamente uma NOTA SUGERIDA: X/5.');
  const nota = notas.length === 1 ? numeroBR(notas[0][1]) : null;
  if (nota != null && (nota < 0 || nota > 5)) erros.push('A nota sugerida está fora da escala de 0 a 5.');
  const pontos = secao(t, 'pontuacao item a item');
  const pares = paresPontuacao(pontos).map(p => [p.obtido, p.maximo]);
  const tabelaOab = /\|\s*(?:item|crit[eé]rio avaliado)\s*\|/i.test(pontos)
    && /\|[^\n]*(?:pontos obtidos|obtido)[^\n]*(?:poss[ií]veis|m[aá]ximo|\/)[^\n]*\|/i.test(pontos)
    && /\|[^\n]*justificativa/i.test(pontos);
  if (!tabelaOab) erros.push('A pontuação deve ser apresentada em tabela no formato de espelho OAB/FGV, com critério, pontos obtidos/possíveis e justificativa detalhada.');
  if (pares.length < 5) erros.push('O espelho OAB/FGV precisa detalhar ao menos cinco itens pontuados.');
  const blocoRobotizacao = secao(t, 'verificacao de robotizacao e supervisao humana');
  const riscoMatch = blocoRobotizacao.match(/\brisco\s*:?[\s*_]*(BAIXO|ATEN[CÇ][AÃ]O|ALTO)\b/i);
  const penalidades = Array.from(blocoRobotizacao.matchAll(/PENALIDADE\s+POR\s+ROBOTIZA[CÇ][AÃ]O\s*:\s*-?\s*(\d+(?:[.,]\d+)?)/gi));
  const risco = riscoMatch ? normalizar(riscoMatch[1]) : null;
  const penalidadeEsperada = risco === 'alto' ? 1 : risco === 'atencao' ? 0.5 : risco === 'baixo' ? 0 : null;
  const penalidade = penalidades.length === 1 ? numeroBR(penalidades[0][1]) : null;
  if (penalidades.length !== 1) erros.push('A verificação de robotização deve declarar exatamente uma PENALIDADE POR ROBOTIZAÇÃO: X,XX.');
  if (penalidadeEsperada == null) erros.push('A verificação de robotização deve classificar o risco como BAIXO, ATENÇÃO ou ALTO.');
  if (penalidade != null && penalidadeEsperada != null && Math.abs(penalidade - penalidadeEsperada) > 0.01) erros.push('A penalidade por robotização não corresponde ao risco: BAIXO = 0,00; ATENÇÃO = 0,50; ALTO = 1,00.');
  const blocoRastreabilidade = secao(t, 'rastreabilidade dos descontos');
  const penalidadeJurisMatch = blocoRastreabilidade.match(/PENALIDADE\s+POR\s+JURISPRUD[EÊ]NCIA\s+N[AÃ]O\s+CONFIRMADA\s*:\s*-?\s*(\d+(?:[.,]\d+)?)/i);
  const penalidadeFormatacaoMatch = blocoRastreabilidade.match(/PENALIDADE\s+POR\s+FORMATA[CÇ][AÃ]O\s+NPJ\s*:\s*-?\s*(\d+(?:[.,]\d+)?)/i);
  const outrasPenalidadesMatch = blocoRastreabilidade.match(/OUTRAS\s+PENALIDADES\s+FORA\s+DO\s+ESPELHO\s*:\s*-?\s*(\d+(?:[.,]\d+)?)/i);
  const totalPenalidadesMatch = blocoRastreabilidade.match(/TOTAL\s+DE\s+PENALIDADES\s+FORA\s+DO\s+ESPELHO\s*:\s*-?\s*(\d+(?:[.,]\d+)?)/i);
  const penalidadeJurisprudencia = penalidadeJurisMatch ? numeroBR(penalidadeJurisMatch[1]) : null;
  const penalidadeFormatacaoNpj = penalidadeFormatacaoMatch ? numeroBR(penalidadeFormatacaoMatch[1]) : 0;
  const outrasPenalidades = outrasPenalidadesMatch ? numeroBR(outrasPenalidadesMatch[1]) : null;
  const totalPenalidades = totalPenalidadesMatch ? numeroBR(totalPenalidadesMatch[1]) : null;
  if (penalidadeJurisprudencia == null || outrasPenalidades == null || totalPenalidades == null) erros.push('A rastreabilidade deve declarar as penalidades de jurisprudência, outras penalidades externas e o total fora do espelho.');
  const blocoJurisprudencia = secao(t, 'verificacao de jurisprudencia e citacoes');
  const ocorrenciasDuvidosas = blocoJurisprudencia.split(/\r?\n/).filter(l => /\b(?:SUSPEITA|N[AÃ]O\s+CONFIRMADA)\b/i.test(l)).length;
  const penalidadeJurisEsperada = Math.min(1, ocorrenciasDuvidosas * 0.25);
  if (penalidadeJurisprudencia != null && Math.abs(penalidadeJurisprudencia - penalidadeJurisEsperada) > 0.01) erros.push('A penalidade jurisprudencial deve ser de 0,25 por ocorrência SUSPEITA ou NÃO CONFIRMADA, limitada a 1,00.');
  if (penalidadeFormatacaoNpj < 0 || penalidadeFormatacaoNpj > 0.60) erros.push('A penalidade objetiva por formatação NPJ deve ficar entre 0,00 e 0,60.');
  if (totalPenalidades != null && penalidade != null && penalidadeJurisprudencia != null && outrasPenalidades != null && Math.abs(totalPenalidades - (penalidade + penalidadeJurisprudencia + penalidadeFormatacaoNpj + outrasPenalidades)) > 0.01) erros.push('O total de penalidades fora do espelho não corresponde à soma das penalidades declaradas.');
  const tabelaRastreabilidade = /\|\s*falha\s+identificada\s*\|[^\n]*aplica[cç][aã]o[^\n]*\|[^\n]*desconto/i.test(blocoRastreabilidade);
  if (!tabelaRastreabilidade) erros.push('A rastreabilidade dos descontos deve ser apresentada em tabela com falha, aplicação e desconto.');
  const linhasRastreabilidade = blocoRastreabilidade.split(/\r?\n/).filter(l => {
    if (!l.trim().startsWith('|') || /^\s*\|?\s*[-:| ]+\|?\s*$/.test(l) || /falha\s+identificada/i.test(l)) return false;
    const celulas = l.split('|').map(c => c.trim()).filter(Boolean);
    return celulas.length >= 3 && (celulas[celulas.length - 1].match(/\d+(?:[.,]\d+)?/) || [])[0];
  });
  if (!linhasRastreabilidade.length) erros.push('A rastreabilidade precisa apresentar ao menos uma linha de conferência dos descontos.');
  const citacaoFalsa = /(?:—|:)\s*INEXISTENTE(?:\/FALSA)?|CITA[CÇ][AÃ]O FALSA DETECTADA/i.test(t);
  if (nota != null && pares.length >= 2) {
    const obtido = pares.reduce((s, p) => s + p[0], 0);
    const possivel = pares.reduce((s, p) => s + p[1], 0);
    const finalCalculada = Math.max(0, obtido - Number(totalPenalidades || 0));
    if (!citacaoFalsa && possivel >= 4.9 && possivel <= 5.1 && Math.abs(finalCalculada - nota) > 0.06) erros.push('A nota sugerida não coincide com o subtotal do espelho menos o total de penalidades fora do espelho.');
  }
  if (nota != null && nota > 0 && citacaoFalsa) erros.push('Foi detectada citação falsa, mas a nota não foi zerada.');
  if (t.length < 900) erros.push('O relatório está curto demais para um espelho OAB/FGV detalhado.');
  if (!/https:\/\/(?:www\.)?(?:planalto\.gov\.br|stf\.jus\.br|stj\.jus\.br|tjdft\.jus\.br|jurisprudencia\.stf\.jus\.br|scon\.stj\.jus\.br)/i.test(t)) erros.push('A correção não contém links para fontes oficiais.');
  return resultado(erros, { nota, riscoRobotizacao: risco, penalidadeRobotizacao: penalidade, penalidadeJurisprudencia, penalidadeFormatacaoNpj, outrasPenalidades, totalPenalidades });
}

module.exports = { normalizar, limparEnunciadoIA, limparGabaritoIA, limparCorrecaoIA, normalizarPenalidadesCorrecao, normalizarGabaritoPenal, validarEnunciado, analisarEspelho, normalizarEspelhoCinco, detectarJurisprudencia, similaridadeNarrativa, validarGabarito, validarCorrecao, contemTrechoExtensoCopiado };
