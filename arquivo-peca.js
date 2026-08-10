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
    if (!/^word\/(?:document|header\d*|footer\d*|footnotes|endnotes|styles|settings)\.xml$/i.test(nome)) continue;
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
    if (/^word\/(?:styles|settings)\.xml$/i.test(nome)) continue;
    const texto = xmlWordParaTexto(conteudo.toString('utf8'));
    if (texto) partes.push((/document\.xml$/i.test(nome) ? '' : '[' + nome.split('/').pop() + ']\n') + texto);
  }
  const texto = limparTexto(partes.join('\n\n'));
  if (texto.length < 40) throw new Error('Não encontrei texto legível no DOCX. Se ele contém apenas imagens, envie em PDF ou use fotos do caderno.');
  return texto.slice(0, LIMITE_TEXTO);
}

const REGRAS_FORMATACAO_NPJ = Object.freeze({
  fonte: 'PT Sans',
  tamanhoTexto: 12,
  tamanhoRodape: 10,
  entrelinhas: 1.15,
  espacoAntesDepoisPt: 6,
  margensCm: { superior: 3, esquerda: 3, inferior: 2, direita: 2 },
  alinhamento: 'justificado',
  recuoPrimeiraLinhaCm: 2,
  paginacao: 'canto superior direito, a partir da segunda página',
  papelTimbrado: 'Papel timbrado oficial do NPJ/IESB'
});

function atributoXml(tag, nome) {
  const m = String(tag || '').match(new RegExp('(?:w:)?' + nome + '="([^"]+)"', 'i'));
  return m ? m[1] : '';
}

function numeroAtributo(tag, nome) {
  const n = Number(atributoXml(tag, nome));
  return Number.isFinite(n) ? n : null;
}

function resultadoAuditoria(formato, verificacoes) {
  const falhas = verificacoes.filter(v => v.status === 'nao_conforme');
  const conformes = verificacoes.filter(v => v.status === 'conforme');
  const naoVerificaveis = verificacoes.filter(v => v.status === 'nao_verificavel');
  return {
    versao: 1,
    formato,
    regras: REGRAS_FORMATACAO_NPJ,
    verificacoes,
    resumo: { conformes: conformes.length, falhas: falhas.length, naoVerificaveis: naoVerificaveis.length },
    aviso: 'Somente falhas objetivamente verificadas no arquivo podem gerar desconto; itens não verificáveis não podem ser penalizados.'
  };
}

function verificacao(codigo, rotulo, status, detalhe, desconto) {
  return { codigo, rotulo, status, detalhe, desconto: status === 'nao_conforme' ? desconto : 0 };
}

function auditarFormatacaoDocx(buf) {
  const entradas = entradasZip(buf);
  const documento = (entradas.get('word/document.xml') || Buffer.alloc(0)).toString('utf8');
  const estilos = (entradas.get('word/styles.xml') || Buffer.alloc(0)).toString('utf8');
  const notasRodape = (entradas.get('word/footnotes.xml') || Buffer.alloc(0)).toString('utf8');
  const cabecalhos = [...entradas].filter(([nome]) => /^word\/header\d*\.xml$/i.test(nome)).map(([, b]) => b.toString('utf8')).join('\n');
  const rodapes = [...entradas].filter(([nome]) => /^word\/footer\d*\.xml$/i.test(nome)).map(([, b]) => b.toString('utf8')).join('\n');
  const baseEstilo = estilos || documento;
  const verificacoes = [];

  const temImagemCabecalho = /<(?:w:drawing|v:shape|w:pict)\b/i.test(cabecalhos);
  const temImagemRodape = /<(?:w:drawing|v:shape|w:pict)\b/i.test(rodapes);
  verificacoes.push(verificacao('papel_timbrado', 'Papel timbrado oficial do NPJ/IESB', temImagemCabecalho && temImagemRodape ? 'conforme' : 'nao_conforme', temImagemCabecalho && temImagemRodape ? 'Foram identificados elementos gráficos no cabeçalho e no rodapé.' : 'Não foram identificados os elementos gráficos esperados simultaneamente no cabeçalho e no rodapé.', 0.15));

  const fontes = Array.from((documento + '\n' + estilos).matchAll(/<w:rFonts\b[^>]*>/gi)).flatMap(m => ['ascii', 'hAnsi', 'cs', 'eastAsia'].map(a => atributoXml(m[0], a)).filter(Boolean));
  const temPtSans = fontes.some(f => /^pt\s*sans$/i.test(f.trim()));
  verificacoes.push(verificacao('fonte', 'Fonte PT Sans', fontes.length ? (temPtSans ? 'conforme' : 'nao_conforme') : 'nao_verificavel', fontes.length ? (temPtSans ? 'A fonte PT Sans está declarada no documento.' : 'As fontes declaradas não incluem PT Sans.') : 'O DOCX não declarou a fonte de modo que o sistema pudesse confirmá-la.', 0.10));

  const tamanhos = Array.from((documento + '\n' + estilos).matchAll(/<w:sz\b[^>]*>/gi)).map(m => numeroAtributo(m[0], 'val')).filter(n => n != null);
  const temTexto12 = tamanhos.some(n => Math.abs(n - 24) <= 0.1);
  const notasComTexto = /<w:t\b[^>]*>[^<\s]/i.test(notasRodape);
  const tamanhosNotas = Array.from((notasRodape + '\n' + estilos).matchAll(/<w:sz\b[^>]*>/gi)).map(m => numeroAtributo(m[0], 'val')).filter(n => n != null);
  const notas10 = !notasComTexto || tamanhosNotas.some(n => Math.abs(n - 20) <= 0.1);
  verificacoes.push(verificacao('tamanho_fonte', 'Tamanho 12 no texto principal e 10 nas notas de rodapé', tamanhos.length ? (temTexto12 && notas10 ? 'conforme' : 'nao_conforme') : 'nao_verificavel', tamanhos.length ? (temTexto12 && notas10 ? 'Foi encontrada configuração de 12 pontos no texto e, quando aplicável, 10 pontos nas notas.' : 'Não foi confirmada a combinação de 12 pontos no texto principal e 10 nas notas de rodapé.') : 'O tamanho da fonte não pôde ser confirmado no DOCX.', 0.05));

  const pgMar = (documento.match(/<w:pgMar\b[^>]*>/i) || [])[0] || '';
  const margens = { top: numeroAtributo(pgMar, 'top'), left: numeroAtributo(pgMar, 'left'), bottom: numeroAtributo(pgMar, 'bottom'), right: numeroAtributo(pgMar, 'right') };
  const margemOk = margens.top != null && Math.abs(margens.top - 1701) <= 90 && Math.abs(margens.left - 1701) <= 90 && Math.abs(margens.bottom - 1134) <= 90 && Math.abs(margens.right - 1134) <= 90;
  verificacoes.push(verificacao('margens', 'Margens 3 cm (superior/esquerda) e 2 cm (inferior/direita)', pgMar ? (margemOk ? 'conforme' : 'nao_conforme') : 'nao_verificavel', pgMar ? (margemOk ? 'As margens correspondem ao padrão, dentro da tolerância técnica.' : 'As margens do documento divergem do padrão 3/3/2/2 cm.') : 'As margens não puderam ser lidas.', 0.10));

  const espacamentos = Array.from((documento + '\n' + baseEstilo).matchAll(/<w:spacing\b[^>]*>/gi)).map(m => m[0]);
  const entrelinhasOk = espacamentos.some(tag => { const line = numeroAtributo(tag, 'line'); return line != null && Math.abs(line - 276) <= 14; });
  const paragrafosOk = espacamentos.some(tag => { const before = numeroAtributo(tag, 'before'); const after = numeroAtributo(tag, 'after'); return before != null && after != null && Math.abs(before - 120) <= 20 && Math.abs(after - 120) <= 20; });
  verificacoes.push(verificacao('espacamento', 'Entrelinhas 1,15 e 6 pt antes/depois dos parágrafos', espacamentos.length ? (entrelinhasOk && paragrafosOk ? 'conforme' : 'nao_conforme') : 'nao_verificavel', espacamentos.length ? (entrelinhasOk && paragrafosOk ? 'O espaçamento corresponde ao padrão.' : 'Não foi possível confirmar simultaneamente entrelinhas 1,15 e 6 pt antes/depois.') : 'O espaçamento não está declarado de forma verificável.', 0.10));

  const temJustificado = /<w:jc\b[^>]*(?:w:)?val="both"/i.test(documento + '\n' + baseEstilo);
  verificacoes.push(verificacao('alinhamento', 'Texto justificado', temJustificado ? 'conforme' : 'nao_conforme', temJustificado ? 'Há configuração de alinhamento justificado.' : 'Não foi encontrada configuração de alinhamento justificado.', 0.05));

  const recuos = Array.from((documento + '\n' + baseEstilo).matchAll(/<w:ind\b[^>]*>/gi)).map(m => numeroAtributo(m[0], 'firstLine')).filter(n => n != null);
  const recuoOk = recuos.some(n => Math.abs(n - 1134) <= 90);
  verificacoes.push(verificacao('recuo', 'Recuo de 2 cm na primeira linha', recuos.length ? (recuoOk ? 'conforme' : 'nao_conforme') : 'nao_verificavel', recuos.length ? (recuoOk ? 'Foi identificado recuo de primeira linha compatível com 2 cm.' : 'O recuo de primeira linha diverge de 2 cm.') : 'O recuo não pôde ser confirmado.', 0.05));

  const temCampoPagina = /(?:instrText[^>]*>[^<]*\bPAGE\b|fldSimple\b[^>]*instr="[^"]*\bPAGE\b)/i.test(cabecalhos);
  const primeiraPaginaDiferente = /<w:titlePg\b/i.test(documento);
  const indicioMaisDeUmaPagina = /<w:lastRenderedPageBreak\b|<w:br\b[^>]*(?:w:)?type="page"/i.test(documento);
  const statusPaginacao = temCampoPagina && primeiraPaginaDiferente ? 'conforme' : (temCampoPagina || indicioMaisDeUmaPagina ? 'nao_conforme' : 'nao_verificavel');
  const detalhePaginacao = statusPaginacao === 'conforme' ? 'A paginação foi encontrada no cabeçalho, com primeira página diferenciada.' : statusPaginacao === 'nao_conforme' ? 'Há indício de múltiplas páginas ou campo de página, mas a numeração correta desde a segunda página não foi confirmada.' : 'O DOCX não permite confirmar que haja uma segunda página; este item não será penalizado.';
  verificacoes.push(verificacao('paginacao', 'Numeração no canto superior direito a partir da segunda página', statusPaginacao, detalhePaginacao, 0.05));

  return resultadoAuditoria('docx', verificacoes);
}

function auditarFormatacaoNaoVerificavel(formato, motivo) {
  return resultadoAuditoria(formato, [
    verificacao('papel_timbrado', 'Papel timbrado oficial do NPJ/IESB', 'nao_verificavel', motivo, 0.15),
    verificacao('fonte', 'Fonte PT Sans e tamanhos 12/10', 'nao_verificavel', motivo, 0.10),
    verificacao('margens', 'Margens 3/3/2/2 cm', 'nao_verificavel', motivo, 0.10),
    verificacao('espacamento', 'Entrelinhas 1,15 e 6 pt antes/depois', 'nao_verificavel', motivo, 0.10),
    verificacao('alinhamento', 'Texto justificado', 'nao_verificavel', motivo, 0.05),
    verificacao('recuo', 'Recuo de 2 cm na primeira linha', 'nao_verificavel', motivo, 0.05),
    verificacao('paginacao', 'Paginação no alto à direita desde a segunda página', 'nao_verificavel', motivo, 0.05)
  ]);
}

function mediana(valores) {
  const lista = (valores || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!lista.length) return null;
  const meio = Math.floor(lista.length / 2);
  return lista.length % 2 ? lista[meio] : (lista[meio - 1] + lista[meio]) / 2;
}

function auditarFormatacaoPdf(dados) {
  const paginas = dados && Array.isArray(dados.paginas) ? dados.paginas : [];
  if (!paginas.length) return auditarFormatacaoNaoVerificavel('pdf', 'Não foi possível obter dados geométricos do PDF.');
  const verificacoes = [];
  const comTimbrado = paginas.filter(p => Number(p.imagens || 0) >= 2).length;
  const papelOk = comTimbrado >= Math.max(1, Math.ceil(paginas.length * 0.75));
  verificacoes.push(verificacao('papel_timbrado', 'Papel timbrado oficial do NPJ/IESB', papelOk ? 'conforme' : 'nao_conforme', papelOk ? 'Foram identificados elementos gráficos recorrentes de cabeçalho e rodapé.' : 'Não foram identificados elementos gráficos recorrentes de cabeçalho e rodapé na maioria das páginas.', 0.15));

  const fontes = paginas.flatMap(p => p.fontes || []);
  const caracteres = fontes.reduce((s, f) => s + Math.max(0, Number(f.caracteres) || 0), 0);
  const caracteresPtSans = fontes.filter(f => /pt\s*sans/i.test(String(f.familia || ''))).reduce((s, f) => s + Math.max(0, Number(f.caracteres) || 0), 0);
  const fonteVerificavel = caracteres > 0 && fontes.some(f => f.familia && !/sans-serif|serif|monospace/i.test(String(f.familia).trim()));
  const fonteOk = caracteresPtSans >= caracteres * 0.60;
  verificacoes.push(verificacao('fonte', 'Fonte PT Sans', fonteVerificavel ? (fonteOk ? 'conforme' : 'nao_conforme') : 'nao_verificavel', fonteVerificavel ? (fonteOk ? 'PT Sans é a fonte predominante no texto extraído.' : 'PT Sans não é a fonte predominante no texto extraído.') : 'O PDF não expôs o nome real da fonte incorporada; não haverá desconto por este item.', 0.10));

  const tamanho = mediana(paginas.flatMap(p => p.tamanhos || []));
  const tamanhoOk = tamanho != null && tamanho >= 11.3 && tamanho <= 12.7;
  verificacoes.push(verificacao('tamanho_fonte', 'Tamanho 12 no texto principal e 10 nas notas de rodapé', tamanho == null ? 'nao_verificavel' : (tamanhoOk ? 'conforme' : 'nao_conforme'), tamanho == null ? 'O tamanho da fonte não pôde ser medido.' : (tamanhoOk ? 'O tamanho predominante é compatível com 12 pontos.' : 'O tamanho predominante medido não é compatível com 12 pontos.'), 0.05));

  const margensMedidas = paginas.filter(p => Number.isFinite(p.margemEsquerda) && Number.isFinite(p.margemDireita));
  const margensOk = margensMedidas.length && margensMedidas.filter(p => p.margemEsquerda >= 73 && p.margemEsquerda <= 98 && p.margemDireita >= 45 && p.margemDireita <= 72).length >= Math.ceil(margensMedidas.length * 0.70);
  verificacoes.push(verificacao('margens', 'Margens 3 cm (superior/esquerda) e 2 cm (inferior/direita)', margensMedidas.length ? (margensOk ? 'conforme' : 'nao_conforme') : 'nao_verificavel', margensMedidas.length ? (margensOk ? 'As margens laterais medidas são compatíveis com o padrão, dentro da tolerância técnica.' : 'As margens laterais medidas divergem do padrão 3/2 cm.') : 'As margens não puderam ser medidas.', 0.10));

  verificacoes.push(verificacao('espacamento', 'Entrelinhas 1,15 e 6 pt antes/depois dos parágrafos', 'nao_verificavel', 'A conversão do PDF não permite distinguir com segurança espaçamento entre linhas e entre parágrafos.', 0.10));
  verificacoes.push(verificacao('alinhamento', 'Texto justificado', 'nao_verificavel', 'A conversão do PDF não permite confirmar o alinhamento com segurança suficiente para desconto.', 0.05));
  verificacoes.push(verificacao('recuo', 'Recuo de 2 cm na primeira linha', 'nao_verificavel', 'A conversão do PDF não permite separar com segurança recuos de títulos, citações e parágrafos.', 0.05));

  const paginasNumeraveis = paginas.slice(1);
  const paginacaoOk = paginasNumeraveis.length === 0 || paginasNumeraveis.every(p => p.numeroSuperiorDireito === true);
  verificacoes.push(verificacao('paginacao', 'Numeração no canto superior direito a partir da segunda página', paginasNumeraveis.length ? (paginacaoOk ? 'conforme' : 'nao_conforme') : 'nao_verificavel', paginasNumeraveis.length ? (paginacaoOk ? 'A numeração foi identificada no alto à direita desde a segunda página.' : 'A numeração não foi encontrada no alto à direita em todas as páginas a partir da segunda.') : 'Documento de uma página; regra de paginação não aplicável.', 0.05));
  return resultadoAuditoria('pdf', verificacoes);
}

function penalidadeFormatacao(auditoria) {
  const verificacoes = auditoria && Array.isArray(auditoria.verificacoes) ? auditoria.verificacoes : [];
  return Math.min(0.60, Math.round(verificacoes.filter(v => v && v.status === 'nao_conforme').reduce((s, v) => s + Math.max(0, Number(v.desconto) || 0), 0) * 100) / 100);
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
  for (const titulo of ['Leitura inicial', 'Referências e citações', 'Integridade do arquivo', 'Formatação NPJ', 'Pontos de atenção', 'Próximo passo']) {
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
  REGRAS_FORMATACAO_NPJ,
  auditarFormatacaoDocx,
  auditarFormatacaoPdf,
  auditarFormatacaoNaoVerificavel,
  penalidadeFormatacao,
  detectarSinaisPrompt,
  analisarRobotizacao,
  validarParecerInicial
};
