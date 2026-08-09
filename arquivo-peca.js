// Leitura segura e sem dependências externas de arquivos Word enviados pelos alunos.
// DOCX é um ZIP de XMLs; DOC legado recebe uma extração conservadora de texto.
const zlib = require('zlib');

const LIMITE_ARQUIVO = 6 * 1024 * 1024;
const LIMITE_TEXTO = 60000;

function limparTexto(texto) {
  return String(texto || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function decodificarEntidadesXml(texto) {
  return String(texto || '').replace(/&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi, (m, hex, dec, nome) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (dec) return String.fromCodePoint(parseInt(dec, 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[String(nome).toLowerCase()] || m;
  });
}

function xmlWordParaTexto(xml) {
  return limparTexto(decodificarEntidadesXml(String(xml || '')
    .replace(/<w:tab\b[^>]*\/?\s*>/gi, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/?\s*>/gi, '\n')
    .replace(/<\/w:(?:p|tr)>/gi, '\n')
    .replace(/<\/w:tc>/gi, '\t')
    .replace(/<[^>]+>/g, '')));
}

function encontrarEocd(buf) {
  const inicio = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= inicio; i--) if (buf.readUInt32LE(i) === 0x06054b50) return i;
  return -1;
}

function entradasZip(buf) {
  const eocd = encontrarEocd(buf);
  if (eocd < 0) throw new Error('O arquivo DOCX está corrompido ou não é um documento Word válido.');
  const total = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const saida = new Map();
  let totalExtraido = 0;
  for (let i = 0; i < total; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('A estrutura interna do DOCX é inválida.');
    const metodo = buf.readUInt16LE(pos + 10);
    const tamanhoComp = buf.readUInt32LE(pos + 20);
    const tamanho = buf.readUInt32LE(pos + 24);
    const nomeLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const comentarioLen = buf.readUInt16LE(pos + 32);
    const local = buf.readUInt32LE(pos + 42);
    const nome = buf.subarray(pos + 46, pos + 46 + nomeLen).toString('utf8').replace(/\\/g, '/');
    pos += 46 + nomeLen + extraLen + comentarioLen;
    if (!/^word\/(?:document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i.test(nome)) continue;
    if (tamanho > 4 * 1024 * 1024 || totalExtraido + tamanho > 8 * 1024 * 1024) throw new Error('O conteúdo interno do DOCX é grande demais.');
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error('A estrutura interna do DOCX é inválida.');
    const localNomeLen = buf.readUInt16LE(local + 26);
    const localExtraLen = buf.readUInt16LE(local + 28);
    const inicio = local + 30 + localNomeLen + localExtraLen;
    if (inicio + tamanhoComp > buf.length) throw new Error('O DOCX terminou antes do esperado.');
    const comprimido = buf.subarray(inicio, inicio + tamanhoComp);
    let conteudo;
    if (metodo === 0) conteudo = Buffer.from(comprimido);
    else if (metodo === 8) conteudo = zlib.inflateRawSync(comprimido, { maxOutputLength: 4 * 1024 * 1024 });
    else throw new Error('O DOCX usa uma compactação não suportada.');
    totalExtraido += conteudo.length;
    saida.set(nome, conteudo);
  }
  return saida;
}

function extrairTextoDocx(buf) {
  const partes = [];
  for (const [nome, conteudo] of entradasZip(buf)) {
    const texto = xmlWordParaTexto(conteudo.toString('utf8'));
    if (texto) partes.push((/document\.xml$/i.test(nome) ? '' : '[' + nome.split('/').pop() + ']\n') + texto);
  }
  const texto = limparTexto(partes.join('\n\n'));
  if (texto.length < 40) throw new Error('Não encontrei texto legível no DOCX. Se ele contém apenas imagens, envie em PDF ou use fotos do caderno.');
  return texto.slice(0, LIMITE_TEXTO);
}

function candidatosTexto(binario, codificacao, regex) {
  const bruto = binario.toString(codificacao).replace(/\u0000/g, '');
  return (bruto.match(regex) || []).map(x => limparTexto(x)).filter(x => x.length >= 8);
}

function extrairTextoDocLegado(buf) {
  // O formato .doc é binário. Recuperamos apenas sequências textuais claras e
  // rejeitamos o resultado quando a confiança é baixa, sem executar macros.
  const unicode = candidatosTexto(buf, 'utf16le', /[\p{L}\p{N}][\p{L}\p{N}\p{P}\p{Zs}\t\r\n]{7,}/gu);
  const latin = candidatosTexto(buf, 'latin1', /[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 .,;:!?()\[\]{}ºª§$%/\\'"\-\r\n\t]{11,}/g);
  const vistos = new Set();
  const partes = unicode.concat(latin).filter(x => {
    const chave = x.toLocaleLowerCase('pt-BR');
    if (vistos.has(chave) || /^(microsoft|worddocument|summaryinformation|compobj|normal\.dot)/i.test(x)) return false;
    vistos.add(chave); return true;
  });
  const texto = limparTexto(partes.join('\n'));
  if (texto.length < 80) throw new Error('Não consegui ler este .doc antigo com segurança. Abra-o no Word e salve como .docx ou PDF.');
  return texto.slice(0, LIMITE_TEXTO);
}

function decodificarDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;,]+)?;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('O arquivo recebido é inválido.');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > LIMITE_ARQUIVO) throw new Error('O arquivo deve ter no máximo 6 MB.');
  return { mime: String(m[1] || '').toLowerCase(), buf };
}

function tipoArquivo(nome, mime, buf) {
  const ext = String(nome || '').toLowerCase().match(/\.(pdf|docx|doc)$/);
  if (!ext) throw new Error('Formato não aceito. Envie PDF, DOCX ou DOC.');
  const tipo = ext[1];
  if (tipo === 'pdf' && buf.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('O arquivo não é um PDF válido.');
  if (tipo === 'docx' && !(buf[0] === 0x50 && buf[1] === 0x4b)) throw new Error('O arquivo não é um DOCX válido.');
  if (tipo === 'doc' && !(buf[0] === 0xd0 && buf[1] === 0xcf)) throw new Error('O arquivo não é um DOC válido.');
  return tipo;
}

function detectarSinaisPrompt(texto) {
  const regras = [
    ['instrução dirigida à IA', /(?:ignore|desconsidere|esqueça|substitua).{0,40}(?:instruç|prompt|sistema|regras?)/i],
    ['marcador de prompt ou sistema', /(?:system\s*prompt|prompt\s*:|<\/?(?:system|assistant|instructions?)>|\[\s*(?:system|assistant)\s*\])/i],
    ['pedido para alterar a avaliação', /(?:dê|atribua|conceda|garanta).{0,30}(?:nota|pontuaç|aprovaç)/i],
    ['texto oculto ou codificado', /(?:texto\s+oculto|hidden\s+text|base64|instruç(?:ão|ões)\s+oculta)/i]
  ];
  return regras.filter(([, re]) => re.test(String(texto || ''))).map(([nome]) => nome);
}

function analisarRobotizacao(texto) {
  const bruto = String(texto || '').replace(/\r/g, '').trim();
  let paragrafos = bruto.split(/\n\s*\n+/).map(x => x.trim()).filter(x => x.length >= 25);
  if (paragrafos.length < 4) paragrafos = bruto.split(/\n+/).map(x => x.trim()).filter(x => x.length >= 35);
  const sinais = [];
  const enumerados = paragrafos.filter(p => /^(?:\(?\d{1,2}[.)-]|[a-z][.)]|[ivxlcdm]{1,6}[.)-]|[-–—•])\s+/i.test(p)).length;
  if (paragrafos.length >= 6 && enumerados / paragrafos.length >= 0.55) sinais.push('enumerações presentes na maioria dos parágrafos');

  const tamanhos = paragrafos.map(p => p.length);
  const media = tamanhos.length ? tamanhos.reduce((a, b) => a + b, 0) / tamanhos.length : 0;
  const desvio = tamanhos.length ? Math.sqrt(tamanhos.reduce((s, n) => s + ((n - media) ** 2), 0) / tamanhos.length) : 0;
  const variacao = media ? desvio / media : 1;
  if (paragrafos.length >= 8 && variacao < 0.18) sinais.push('parágrafos com extensão incomumente uniforme');

  const aberturas = new Map();
  for (const p of paragrafos) {
    const inicio = p.toLocaleLowerCase('pt-BR').replace(/[^a-zà-ÿ\s]/g, '').split(/\s+/).slice(0, 3).join(' ');
    if (inicio.split(' ').length >= 3) aberturas.set(inicio, (aberturas.get(inicio) || 0) + 1);
  }
  if ([...aberturas.values()].some(n => n >= 3)) sinais.push('aberturas de parágrafo repetidas de forma padronizada');

  const linhas = bruto.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const topicos = [];
  let atual = null;
  for (const linha of linhas) {
    const letras = linha.replace(/[^A-Za-zÀ-ÿ]/g, '');
    const maiusculas = letras.replace(/[^A-ZÀ-Ý]/g, '').length;
    const cabecalho = linha.length <= 110 && (/^(?:\d+(?:\.\d+)*|[IVXLCDM]+)[.)-]?\s+/i.test(linha) || /^(?:DOS?|DAS?|DA|DO)\s+[A-ZÀ-Ý]/.test(linha) || (letras.length >= 4 && maiusculas / letras.length > 0.82));
    if (cabecalho) { atual = { titulo: linha, paragrafos: 0 }; topicos.push(atual); }
    else if (atual && linha.length >= 25) atual.paragrafos++;
  }
  const contagens = topicos.filter(t => t.paragrafos > 0).map(t => t.paragrafos);
  if (contagens.length >= 3 && new Set(contagens).size === 1) sinais.push('mesmo número de parágrafos em todos os tópicos detectados');

  const conectores = ['ademais', 'outrossim', 'nesse sentido', 'diante disso', 'por conseguinte', 'cumpre destacar'];
  const repetidos = conectores.filter(c => (bruto.toLocaleLowerCase('pt-BR').match(new RegExp(c, 'g')) || []).length >= 3);
  if (repetidos.length) sinais.push('conectores formulaicos repetidos: ' + repetidos.join(', '));

  return {
    nivel: sinais.length >= 3 ? 'alto' : (sinais.length ? 'atenção' : 'baixo'),
    sinais,
    metricas: { paragrafos: paragrafos.length, paragrafosEnumerados: enumerados, topicosDetectados: contagens.length, variacaoExtensao: Math.round(variacao * 100) / 100 },
    ressalva: 'Padrões formais são apenas indícios de robotização e não comprovam autoria por IA.'
  };
}

function validarParecerInicial(texto) {
  const t = String(texto || '').trim();
  const erros = [];
  if (t.length < 250) erros.push('parecer curto demais');
  for (const titulo of ['Leitura inicial', 'Referências e citações', 'Integridade do arquivo', 'Pontos de atenção', 'Próximo passo']) {
    if (!new RegExp('##\\s*' + titulo, 'i').test(t)) erros.push('seção ausente: ' + titulo);
  }
  if (/\b(?:gabarito|espelho de correção|resposta-modelo|peça correta)\b/i.test(t)) erros.push('conteúdo reservado mencionado');
  if (/\bnota\b|pontua(?:ç|c)[aã]o|\b\d+(?:[,.]\d+)?\s*\/\s*(?:5|10|100)\b/i.test(t)) erros.push('nota ou pontuação mencionada');
  return { ok: !erros.length, erros };
}

module.exports = {
  LIMITE_ARQUIVO,
  LIMITE_TEXTO,
  decodificarDataUrl,
  tipoArquivo,
  extrairTextoDocx,
  extrairTextoDocLegado,
  detectarSinaisPrompt,
  analisarRobotizacao,
  validarParecerInicial
};
