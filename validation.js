'use strict';

function normalizar(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function resultado(erros, detalhes) {
  return { ok: erros.length === 0, erros, detalhes: detalhes || {} };
}

function validarEnunciado(texto) {
  const t = String(texto || '').trim();
  const n = normalizar(t);
  const erros = [];
  if (t.length < 300) erros.push('O enunciado está curto demais.');
  if (t.length > 20000) erros.push('O enunciado ultrapassa 20.000 caracteres.');
  if (!/na\s+condi[cç][aã]o\s+de\s+advogad[oa]\s*\(?a?\)?/i.test(t)) erros.push('Falta o comando final iniciado por “Na condição de advogado(a) de...”.');
  if (!/valor\s*:\s*5[,.]00/i.test(t)) erros.push('Falta a indicação “Valor: 5,00”.');
  const datasNumericas = t.match(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{4}\b/g) || [];
  const datasExtenso = t.match(/\b\d{1,2}\s+de\s+[a-zç]+\s+de\s+\d{4}\b/gi) || [];
  if (datasNumericas.length + datasExtenso.length < 2) erros.push('O caso precisa de ao menos duas datas completas para permitir a conferência da cronologia e do prazo.');
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

function validarCorrecao(texto) {
  const t = String(texto || '').trim();
  const n = normalizar(t);
  const erros = [];
  const obrigatorias = ['acertos', 'erros formais', 'erros materiais', 'pontuacao item a item', 'verificacao de jurisprudencia e citacoes', 'propostas de aprimoramento', 'fontes e links'];
  for (const titulo of obrigatorias) if (!new RegExp('^\\s*##\\s+.*' + titulo.replace(/ /g, '.*'), 'mi').test(n)) erros.push('Falta a seção “' + titulo + '”.');
  const notas = Array.from(t.matchAll(/NOTA\s+SUGERIDA\s*:\s*(\d+(?:[.,]\d+)?)\s*\/\s*10/gi));
  if (notas.length !== 1) erros.push('A correção precisa conter exatamente uma NOTA SUGERIDA: X/10.');
  const nota = notas.length === 1 ? numeroBR(notas[0][1]) : null;
  if (nota != null && (nota < 0 || nota > 10)) erros.push('A nota sugerida está fora da escala de 0 a 10.');
  const pontos = secao(t, 'pontuacao item a item');
  const pares = Array.from(pontos.matchAll(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/g)).map(m => [numeroBR(m[1]), numeroBR(m[2])]);
  if (nota != null && pares.length >= 2) {
    const obtido = pares.reduce((s, p) => s + p[0], 0);
    const possivel = pares.reduce((s, p) => s + p[1], 0);
    if (possivel >= 9.9 && possivel <= 10.1 && Math.abs(obtido - nota) > 0.11) erros.push('A nota sugerida não coincide com a soma dos itens.');
  }
  if (nota != null && nota > 0 && /(?:—|:)\s*INEXISTENTE(?:\/FALSA)?|CITA[CÇ][AÃ]O FALSA DETECTADA/i.test(t)) erros.push('Foi detectada citação falsa, mas a nota não foi zerada.');
  if (t.length < 500) erros.push('O relatório está curto demais para uma correção completa.');
  if (!/https:\/\/(?:www\.)?(?:planalto\.gov\.br|stf\.jus\.br|stj\.jus\.br|tjdft\.jus\.br|jurisprudencia\.stf\.jus\.br|scon\.stj\.jus\.br)/i.test(t)) erros.push('A correção não contém links para fontes oficiais.');
  return resultado(erros, { nota });
}

module.exports = { normalizar, validarEnunciado, analisarEspelho, detectarJurisprudencia, similaridadeNarrativa, validarGabarito, validarCorrecao };
