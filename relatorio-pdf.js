'use strict';

const LARGURA = 595.28;
const ALTURA = 841.89;
const MARGEM = 42;

function textoSeguro(v) {
  return String(v == null ? '' : v)
    .replace(/[–—−]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/•/g, '-')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '?');
}
function escPdf(v) { return textoSeguro(v).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function escHtml(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function limparMarkdown(v) { return String(v || '').replace(/^[-*]\s+/, '').replace(/\*\*/g, '').trim(); }
function numeroPt(v) { return String(v == null ? '0' : v).replace('.', ','); }

function secoesRelatorio(relatorio) {
  const secoes = [];
  let atual = { titulo: 'Síntese da avaliação', linhas: [] };
  for (const linha of String(relatorio || '').split(/\r?\n/)) {
    const h = linha.match(/^##\s+(.+)/);
    if (h) { if (atual.linhas.some(x => x.trim())) secoes.push(atual); atual = { titulo: limparMarkdown(h[1]), linhas: [] }; }
    else if (!/^NOTA\s+SUGERIDA/i.test(linha.trim())) atual.linhas.push(linha);
  }
  if (atual.linhas.some(x => x.trim())) secoes.push(atual);
  return secoes;
}

function linhasEspelho(linhas) {
  const itens = [];
  for (const original of linhas || []) {
    const linha = original.trim();
    if (!linha || /^\|?\s*[-:| ]+\|?$/.test(linha)) continue;
    const pares = Array.from(linha.matchAll(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/g));
    const par = pares.reverse().find(m => {
      const obtido = Number(m[1].replace(',', '.')), maximo = Number(m[2].replace(',', '.'));
      return Number.isFinite(obtido) && Number.isFinite(maximo) && obtido >= 0 && maximo > 0 && obtido <= maximo && maximo <= 5;
    });
    if (!par) continue;
    let criterio = '', esperado = '', justificativa = '';
    if (linha.startsWith('|')) {
      const c = linha.slice(1, -1).split('|').map(x => limparMarkdown(x));
      if (/item|crit[eé]rio/i.test(c.join(' ')) && !/\d+(?:[.,]\d+)?\s*\//.test(c.join(' '))) continue;
      const indiceNota = c.findIndex(x => /\d+(?:[.,]\d+)?\s*\/\s*\d/.test(x));
      const anteriores = c.slice(0, Math.max(1, indiceNota)).filter(x => !/^\d+$/.test(x));
      criterio = anteriores.join(' - ') || 'Critério avaliado';
      esperado = '';
      justificativa = c.slice(indiceNota + 1).join(' ');
    } else {
      const antes = limparMarkdown(linha.slice(0, par.index)).replace(/[:;-]+$/, '').trim();
      criterio = antes || 'Critério avaliado';
      justificativa = limparMarkdown(linha.slice((par.index || 0) + par[0].length)).replace(/^[:;-]+/, '').trim();
    }
    itens.push({ criterio, esperado, obtido: par[1], maximo: par[2], justificativa: justificativa || 'Pontuação atribuída conforme o gabarito e a resposta apresentada.' });
  }
  return itens;
}

function quebrarTexto(texto, largura, tamanho) {
  const max = Math.max(8, Math.floor(largura / (tamanho * 0.51)));
  const saida = [];
  for (const paragrafo of textoSeguro(texto).split(/\r?\n/)) {
    const palavras = paragrafo.trim().split(/\s+/).filter(Boolean);
    if (!palavras.length) { saida.push(''); continue; }
    let linha = '';
    for (const palavra of palavras) {
      if (!linha) linha = palavra;
      else if ((linha + ' ' + palavra).length <= max) linha += ' ' + palavra;
      else { saida.push(linha); linha = palavra; }
    }
    if (linha) saida.push(linha);
  }
  return saida;
}

function gerarPdfEspelho(dados) {
  const paginas = [[]];
  let pagina = 0, y = 96;
  const corAzul = [0.075, 0.188, 0.337], corDourada = [0.78, 0.59, 0.22], corCinza = [0.35, 0.38, 0.42];
  const cmd = s => paginas[pagina].push(s);
  const cor = c => c.join(' ') + ' rg';
  function retangulo(x, topo, w, h, preenchimento, borda) {
    if (preenchimento) cmd(cor(preenchimento) + ` ${x} ${ALTURA - topo - h} ${w} ${h} re f`);
    if (borda) cmd(borda.join(' ') + ` RG 0.7 w ${x} ${ALTURA - topo - h} ${w} ${h} re S`);
  }
  function cabecalho() {
    retangulo(0, 0, LARGURA, 58, corAzul);
    cmd(`BT /F2 14 Tf 1 1 1 rg ${MARGEM} ${ALTURA - 27} Td (${escPdf('ESPELHO DE CORREÇÃO DO ESTÁGIO')}) Tj ET`);
    cmd(`BT /F1 8.5 Tf 1 1 1 rg ${MARGEM} ${ALTURA - 43} Td (${escPdf('Formato OAB/FGV adaptado - escala da disciplina: 0 a 5')}) Tj ET`);
    retangulo(MARGEM, 63, LARGURA - 2 * MARGEM, 2, corDourada);
  }
  function novaPagina() { pagina++; paginas.push([]); y = 82; cabecalho(); }
  function espaco(h) { if (y + h > ALTURA - 54) novaPagina(); }
  function linhaTexto(texto, op) {
    op = op || {}; const tamanho = op.tamanho || 9.4, largura = op.largura || (LARGURA - 2 * MARGEM), lh = op.lh || tamanho * 1.42;
    const linhas = quebrarTexto(texto, largura, tamanho); espaco(Math.max(lh, linhas.length * lh) + (op.depois || 0));
    for (const linha of linhas) {
      if (linha) cmd(`BT /${op.negrito ? 'F2' : 'F1'} ${tamanho} Tf ${cor(op.cor || [0.13, 0.15, 0.18])} ${op.x || MARGEM} ${ALTURA - y - tamanho} Td (${escPdf(linha)}) Tj ET`);
      y += lh;
    }
    y += op.depois || 0;
  }
  function tituloSecao(titulo) {
    espaco(54); y += 5; retangulo(MARGEM, y, LARGURA - 2 * MARGEM, 24, [0.92, 0.94, 0.97]);
    cmd(`BT /F2 10 Tf ${cor(corAzul)} ${MARGEM + 9} ${ALTURA - y - 16} Td (${escPdf(titulo.toUpperCase())}) Tj ET`); y += 31;
  }
  cabecalho();
  linhaTexto('Identificação da avaliação', { negrito: true, tamanho: 12, cor: corAzul, depois: 4 });
  const campos = [
    ['Aluno(a)', dados.aluno || '-'], ['Matrícula', dados.matricula || '-'], ['Turma', dados.turma || '-'],
    ['Rodada', 'Peça ' + (dados.rodada || '-')], ['Peça processual', dados.nomePeca || '-'], ['Data da correção', dados.data || '-']
  ];
  for (let i = 0; i < campos.length; i += 2) {
    espaco(35);
    for (let c = 0; c < 2; c++) {
      const item = campos[i + c]; if (!item) continue; const x = MARGEM + c * 260;
      cmd(`BT /F2 7.5 Tf ${cor(corCinza)} ${x} ${ALTURA - y - 8} Td (${escPdf(item[0].toUpperCase())}) Tj ET`);
      const linhas = quebrarTexto(item[1], 242, 9.2).slice(0, 2);
      linhas.forEach((l, j) => cmd(`BT /F1 9.2 Tf 0.12 0.14 0.17 rg ${x} ${ALTURA - y - 21 - j * 11} Td (${escPdf(l)}) Tj ET`));
    }
    y += 36;
  }
  espaco(58); retangulo(MARGEM, y, LARGURA - 2 * MARGEM, 48, corAzul);
  cmd(`BT /F1 9 Tf 1 1 1 rg ${MARGEM + 14} ${ALTURA - y - 18} Td (${escPdf('NOTA FINAL')}) Tj ET`);
  cmd(`BT /F2 22 Tf 1 1 1 rg ${MARGEM + 14} ${ALTURA - y - 40} Td (${escPdf(numeroPt(dados.nota) + ' / 5')}) Tj ET`); y += 58;

  if (dados.recurso) {
    tituloSecao('Resultado do recurso - ' + (dados.recurso.resultado || 'Decidido'));
    if (dados.recurso.notaAnterior != null) linhaTexto('Nota recorrida: ' + numeroPt(dados.recurso.notaAnterior) + '/5. Nota após o recurso: ' + numeroPt(dados.nota) + '/5.', { negrito: true });
    linhaTexto(dados.recurso.decisao || 'Decisão registrada pelo professor.', { tamanho: 9.1, lh: 13, depois: 4 });
  }

  const secoes = secoesRelatorio(dados.relatorio);
  for (const secao of secoes) {
    const ehEspelho = /pontua[cç][aã]o item a item|espelho/i.test(secao.titulo);
    tituloSecao(secao.titulo);
    if (ehEspelho) {
      const itens = linhasEspelho(secao.linhas);
      if (!itens.length) { linhaTexto(secao.linhas.map(limparMarkdown).filter(Boolean).join('\n')); continue; }
      const col = [MARGEM, MARGEM + 238, MARGEM + 304, MARGEM + 370];
      const widths = [232, 60, 60, 141];
      function cabTabela() {
        espaco(29); retangulo(MARGEM, y, LARGURA - 2 * MARGEM, 25, corAzul);
        ['Critério avaliado', 'Obtido', 'Máximo', 'Justificativa'].forEach((t, i) => cmd(`BT /F2 7.5 Tf 1 1 1 rg ${col[i] + 5} ${ALTURA - y - 16} Td (${escPdf(t)}) Tj ET`)); y += 25;
      }
      cabTabela();
      for (const item of itens) {
        const crit = item.criterio + (item.esperado ? ' - ' + item.esperado : '');
        const textos = [quebrarTexto(crit, widths[0] - 10, 7.7), [item.obtido], [item.maximo], quebrarTexto(item.justificativa, widths[3] - 10, 7.4)];
        const h = Math.max(30, Math.max(...textos.map(x => x.length)) * 10 + 10);
        if (y + h > ALTURA - 54) { novaPagina(); cabTabela(); }
        retangulo(MARGEM, y, LARGURA - 2 * MARGEM, h, [0.985, 0.985, 0.98], [0.78, 0.79, 0.8]);
        for (let i = 0; i < textos.length; i++) textos[i].forEach((t, j) => cmd(`BT /${i === 1 || i === 2 ? 'F2' : 'F1'} ${i === 3 ? 7.4 : 7.7} Tf 0.12 0.14 0.17 rg ${col[i] + 5} ${ALTURA - y - 14 - j * 10} Td (${escPdf(t)}) Tj ET`));
        y += h;
      }
      y += 5;
    } else {
      for (const original of secao.linhas) {
        const linha = limparMarkdown(original); if (!linha || /^\|?\s*[-:| ]+\|?$/.test(linha)) continue;
        linhaTexto((/^[-*]/.test(original.trim()) ? '- ' : '') + linha, { tamanho: 9.1, lh: 13, depois: 2 });
      }
    }
  }

  for (let i = 0; i < paginas.length; i++) {
    const rodape = `Laboratório de Peças Penais - Espelho de correção | Página ${i + 1} de ${paginas.length}`;
    paginas[i].push(`0.72 0.73 0.75 RG 0.5 w ${MARGEM} 38 m ${LARGURA - MARGEM} 38 l S`);
    paginas[i].push(`BT /F1 7.5 Tf 0.4 0.42 0.45 rg ${MARGEM} 24 Td (${escPdf(rodape)}) Tj ET`);
  }
  return montarPdf(paginas);
}

function montarPdf(paginas) {
  const objetos = [null];
  const add = conteudo => { objetos.push(Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, 'latin1')); return objetos.length - 1; };
  const fonte = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fonteBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const paginasId = add('');
  const idsPaginas = [];
  for (const comandos of paginas) {
    const dados = Buffer.from(['q'].concat(comandos, ['Q']).join('\n'), 'latin1');
    const stream = add(Buffer.concat([Buffer.from(`<< /Length ${dados.length} >>\nstream\n`, 'latin1'), dados, Buffer.from('\nendstream', 'latin1')]));
    idsPaginas.push(add(`<< /Type /Page /Parent ${paginasId} 0 R /MediaBox [0 0 ${LARGURA} ${ALTURA}] /Resources << /Font << /F1 ${fonte} 0 R /F2 ${fonteBold} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  objetos[paginasId] = Buffer.from(`<< /Type /Pages /Count ${idsPaginas.length} /Kids [${idsPaginas.map(id => id + ' 0 R').join(' ')}] >>`, 'latin1');
  const catalogo = add(`<< /Type /Catalog /Pages ${paginasId} 0 R >>`);
  const partes = [Buffer.from('%PDF-1.4\n%âãÏÓ\n', 'latin1')];
  const offsets = [0]; let pos = partes[0].length;
  for (let i = 1; i < objetos.length; i++) { offsets[i] = pos; const b = Buffer.concat([Buffer.from(`${i} 0 obj\n`, 'latin1'), objetos[i], Buffer.from('\nendobj\n', 'latin1')]); partes.push(b); pos += b.length; }
  const inicioXref = pos;
  let xref = `xref\n0 ${objetos.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objetos.length; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  xref += `trailer\n<< /Size ${objetos.length} /Root ${catalogo} 0 R >>\nstartxref\n${inicioXref}\n%%EOF`;
  partes.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(partes);
}

function relatorioParaHtml(dados) {
  const secoes = secoesRelatorio(dados.relatorio);
  let corpo = '';
  for (const secao of secoes) {
    const itens = /pontua[cç][aã]o item a item|espelho/i.test(secao.titulo) ? linhasEspelho(secao.linhas) : [];
    corpo += '<section style="margin:22px 0"><h2 style="font-size:16px;color:#133056;border-bottom:2px solid #c89a38;padding-bottom:6px">' + escHtml(secao.titulo) + '</h2>';
    if (itens.length) {
      corpo += '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#133056;color:#fff"><th style="padding:8px;text-align:left">Critério avaliado</th><th style="padding:8px">Obtido</th><th style="padding:8px">Máximo</th><th style="padding:8px;text-align:left">Justificativa</th></tr></thead><tbody>';
      for (const item of itens) corpo += '<tr><td style="border:1px solid #d8d8d8;padding:8px">' + escHtml(item.criterio + (item.esperado ? ' - ' + item.esperado : '')) + '</td><td style="border:1px solid #d8d8d8;padding:8px;text-align:center"><b>' + escHtml(item.obtido) + '</b></td><td style="border:1px solid #d8d8d8;padding:8px;text-align:center">' + escHtml(item.maximo) + '</td><td style="border:1px solid #d8d8d8;padding:8px">' + escHtml(item.justificativa) + '</td></tr>';
      corpo += '</tbody></table>';
    } else {
      const linhas = secao.linhas.map(limparMarkdown).filter(x => x && !/^\|?\s*[-:| ]+\|?$/.test(x));
      corpo += '<ul style="padding-left:20px">' + linhas.map(x => '<li style="margin:7px 0">' + escHtml(x) + '</li>').join('') + '</ul>';
    }
    corpo += '</section>';
  }
  const recurso = dados.recurso ? '<div style="border:1px solid #c89a38;background:#fff9e8;padding:14px 16px;margin:14px 0"><b>Resultado do recurso: ' + escHtml(dados.recurso.resultado || '') + '</b><p>' + escHtml(dados.recurso.decisao || '') + '</p></div>' : '';
  return '<div style="font-family:Arial,sans-serif;color:#242a32;line-height:1.5"><div style="background:#133056;color:#fff;padding:18px 22px;border-bottom:5px solid #c89a38"><h1 style="font-size:20px;margin:0">Espelho de correção do Estágio</h1><p style="margin:5px 0 0">Formato OAB/FGV adaptado · escala da disciplina: 0 a 5 · Peça ' + escHtml(dados.rodada) + ' - ' + escHtml(dados.nomePeca) + '</p></div><div style="padding:18px 22px"><p><b>Aluno(a):</b> ' + escHtml(dados.aluno) + ' &nbsp; <b>Matrícula:</b> ' + escHtml(dados.matricula) + '<br><b>Turma:</b> ' + escHtml(dados.turma) + '</p><div style="display:inline-block;background:#133056;color:#fff;padding:10px 18px;border-radius:5px;font-size:18px"><b>Nota final: ' + escHtml(numeroPt(dados.nota)) + '/5</b></div>' + recurso + corpo + '</div></div>';
}

module.exports = { gerarPdfEspelho, relatorioParaHtml, linhasEspelho, secoesRelatorio };
