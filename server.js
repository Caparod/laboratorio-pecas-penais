// Laboratório de Peças Penais — servidor Node puro (sem dependências)
// A chave da API fica APENAS na variável de ambiente ANTHROPIC_API_KEY.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ===== Persistência (disco do Render em DATA_DIR) =====
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync('/var/data') ? '/var/data' : __dirname);
const DB_PATH = path.join(DATA_DIR, 'db.json');
function hashSenha(senha, salt) {
  salt = salt || crypto.randomBytes(8).toString('hex');
  return salt + ':' + crypto.scryptSync(String(senha), salt, 32).toString('hex');
}
function confereSenha(senha, hash) {
  if (!hash) return false;
  const salt = hash.split(':')[0];
  return hashSenha(senha, salt) === hash;
}
let db;
function dbPadrao() {
  return {
    turmaAtiva: 'Estágio I',
    alunos: {},
    professor: { login: (process.env.PROF_LOGIN || '500686'), senha: hashSenha(process.env.PROF_SENHA || 'trocar-no-primeiro-acesso'), mudouSenha: false },
    professores: {},
    pecas: {},
    proximoNum: 1,
    entregas: {}
  };
}
function migrarDb() {
  // Garante campos novos em bancos antigos e cria os professores/coordenadora padrão
  if (!db.professores) db.professores = {};
  if (!db.pecas) db.pecas = {};
  if (typeof db.proximoNum !== 'number') db.proximoNum = 1 + Object.keys(db.pecas).length;
  if (!db.entregas) db.entregas = {};
  if (!db.sessoes) db.sessoes = {}; // sessões persistidas (sobrevivem a reinícios/deploys)
  // professor principal (Rodrigo) — mantém o registro legado db.professor
  if (!db.professor) db.professor = { login: (process.env.PROF_LOGIN || '500686'), senha: hashSenha(process.env.PROF_SENHA || 'trocar-no-primeiro-acesso'), mudouSenha: false };
  db.professores[db.professor.login] = db.professor; // espelha o principal na coleção
  db.professor.nome = db.professor.nome || 'Prof. Rodrigo Silva Pereira';
  db.professor.papel = 'Administrador';
  // Coordenadora Karine (mesmos poderes de professora) — cria uma vez
  if (!db.professores['Karine'] && !db.karineCriada) {
    db.professores['Karine'] = { login: 'Karine', senha: hashSenha('123456'), mudouSenha: false, nome: 'Karine Morais', papel: 'Coordenadora do NPJ' };
    db.karineCriada = true;
  }
}
function carregarDb() {
  try { db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { db = dbPadrao(); }
  migrarDb();
  salvarDb();
}
function professorDe(login) { if (!login) return null; if (db.professores && db.professores[login]) return db.professores[login]; if (db.professor && db.professor.login === login) return db.professor; return null; }
// ===== Papéis: Administrador (dono) > Coordenador > Professor =====
const OWNER_LOGIN = (process.env.PROF_LOGIN || '500686');
function ehAdmin(login) { return !!login && login === OWNER_LOGIN; }
function ehCoordenador(login) { const p = professorDe(login); return !!(p && /coorden/i.test(p.papel || '')); }
function papelDe(login) { if (ehAdmin(login)) return 'Administrador'; const p = professorDe(login); if (p && /coorden/i.test(p.papel || '')) return 'Coordenador'; return 'Professor'; }
function podeGerirProfessores(login) { return ehAdmin(login) || ehCoordenador(login); }
function salvarDb() { try { fs.writeFileSync(DB_PATH, JSON.stringify(db)); } catch (e) { console.error('Falha ao salvar db:', e.message); } }
carregarDb();
// Autodiagnóstico de persistência (aparece nos logs do Render)
try {
  const marcador = path.join(DATA_DIR, '.persist-check');
  let anterior = ''; try { anterior = fs.readFileSync(marcador, 'utf8'); } catch {}
  fs.writeFileSync(marcador, new Date().toISOString());
  console.log('[PERSIST] DATA_DIR=' + DATA_DIR + ' | db.json existe=' + fs.existsSync(DB_PATH) + ' | alunos=' + Object.keys(db.alunos).length + ' | marcador anterior=' + (anterior || 'NENHUM (disco novo ou não persistente)'));
} catch (e) { console.log('[PERSIST] ERRO ao escrever em ' + DATA_DIR + ': ' + e.message); }

// ===== Sessões em memória (relogin após reinício) =====
const APP_URL = process.env.APP_URL || 'https://laboratorio-pecas-penais.onrender.com';
const sessoes = new Map();
// Rehidrata sessões salvas em disco (para não deslogar todos a cada deploy/reinício)
try { for (const [t, v] of Object.entries(db.sessoes || {})) sessoes.set(t, v); } catch (e) {}
function novaSessao(usuario, tipo) {
  const t = crypto.randomBytes(24).toString('hex');
  sessoes.set(t, { usuario, tipo });
  db.sessoes = db.sessoes || {}; db.sessoes[t] = { usuario, tipo }; salvarDb();
  return t;
}
function encerrarSessao(t) { if (!t) return; sessoes.delete(t); if (db.sessoes) { delete db.sessoes[t]; salvarDb(); } }
function sessaoDe(req) { const a = req.headers['authorization'] || ''; const t = a.replace('Bearer ', '').trim(); return t ? sessoes.get(t) : null; }
function semanaAtual() { const d = new Date(); const inicio = new Date(d.getFullYear(), 0, 1); const dias = Math.floor((d - inicio) / 86400000); return d.getFullYear() + '-S' + Math.ceil((dias + inicio.getDay() + 1) / 7); }
const LIMITE_SEMANAL = parseInt(process.env.LIMITE_SEMANAL || '5', 10);
async function lerJson(req, max) { let b = ''; for await (const c of req) { b += c; if (b.length > (max || 300000)) throw new Error('grande'); } return JSON.parse(b); }

// ===== Envio de e-mail (Gmail SMTP via nodemailer) =====
let _transport = null;
function transporteEmail() {
  if (_transport) return _transport;
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  let nodemailer; try { nodemailer = require('nodemailer'); } catch { return null; }
  _transport = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
  return _transport;
}
async function enviarEmail(para, assunto, html) {
  const t = transporteEmail();
  if (!t) { console.log('[EMAIL] indisponível (defina GMAIL_USER e GMAIL_APP_PASSWORD). Assunto: ' + assunto); return { ok: false, motivo: 'sem-config' }; }
  try {
    await t.sendMail({ from: 'Laboratório de Peças Penais - IESB <' + process.env.GMAIL_USER + '>', to: para, subject: assunto, html });
    return { ok: true };
  } catch (e) { console.error('[EMAIL] falha:', e.message); return { ok: false, motivo: e.message }; }
}
function codigo6() { return String(Math.floor(100000 + Math.random() * 900000)); }
function escHtml(t) { return String(t || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

const PUBLIC = __dirname; // index.html na raiz do repositório
const MIME = { '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };

// Rate limit simples por IP: 8 correções por minuto
const hits = new Map();
function limitado(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (arr.length >= 8) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr); return false;
}

const SISTEMA = 'Você é o Professor Me. Rodrigo Silva Pereira, professor de Estágio (prática penal) do curso de Direito do IESB e corrige peças processuais penais de alunos. Corrija com rigor técnico e tom encorajador, sempre explicando o porquê de cada erro e citando os artigos de lei. Critérios da disciplina: correlação entre o pedido e o respondido; fundamentos; português; adequação da linguagem; clareza e objetividade; apresentação formal. Avalie: cabimento da peça, endereçamento, qualificação e capacidade postulatória, tempestividade/prazo, fidelidade aos fatos, fundamentação (preliminares antes do mérito, teses com artigos), pedidos completos e subsidiários, fechamento formal. RESUMO DA PEÇA (art. 343-A do RISTJ, emenda regimental de 2026): toda peça deve abrir com um tópico de SÍNTESE resumindo os fatos, os pedidos, a decisão impugnada (quando recursal) e os dispositivos legais invocados — no STJ é exigência regimental para triagem; nas demais peças, é padrão da disciplina. Avalie a presença e a qualidade do resumo; a ausência é erro formal e desconta pontos. TOPIFICAÇÃO E PROFUNDIDADE: uma boa peça é topificada — cada argumento em tópico próprio e bem definido (DOS FATOS, DO DIREITO com subtópicos por tese, DOS PEDIDOS), de modo que o leitor apreenda toda a linha argumentativa da peça de relance, batendo o olho nos títulos. Cada tópico precisa ser desenvolvido e sustentado, com jurisprudência e citações VÁLIDAS sempre que possível; tópico raso, de apenas um ou dois parágrafos, indica argumentação insuficiente: aponte-o como erro, desconte na nota e mostre nas propostas de aprimoramento como desenvolvê-lo. \n\nREGRA DE TOLERÂNCIA ZERO COM CITAÇÕES FALSAS: use a ferramenta de busca na web (web_search) para VERIFICAR nos sites oficiais (stf.jus.br, stj.jus.br, tjdft.jus.br, planalto.gov.br) — podendo usar o jusbrasil.com.br como fonte complementar de localização, mas a classificação INEXISTENTE/FALSA e os links do anexo devem se basear preferencialmente nas fontes oficiais — TODAS as súmulas, julgados, precedentes e dispositivos citados pelo aluno — pesquise o número e confira o teor. Também use a busca para confirmar e obter os links reais das fontes que VOCÊ citar no anexo. Quando o aluno citar acórdão do TJDFT, use PRIORITARIAMENTE a ferramenta consultar_tjdft (API oficial do tribunal) para verificar número, relator, órgão e teor. Classifique cada um como CONFIRMADA (existe e o teor confere), SUSPEITA (não foi possível confirmar) ou INEXISTENTE/FALSA (súmula que não existe, julgado inventado, número fabricado ou teor falso atribuído a tribunal ou à lei). Se houver QUALQUER citação INEXISTENTE/FALSA, a NOTA SUGERIDA é obrigatoriamente 0/10 — escreva "NOTA SUGERIDA: 0/10 — CITAÇÃO FALSA DETECTADA" e explique exatamente qual citação é falsa e por quê. Citações apenas SUSPEITAS não zeram a nota: desconte pontos, alerte o aluno e recomende verificação pelo professor. Não zere por mera dúvida. ANEXO DE FONTES (exigência da disciplina): o anexo SÓ é exigível quando o aluno cita jurisprudência (súmulas/julgados) — se a peça não usa jurisprudência e se sustenta apenas na lei, isso NÃO é falha e não deve ser penalizado. Quando houver citação de jurisprudência, a peça deve terminar com um ANEXO listando TODAS as fontes citadas (cada súmula/julgado/lei com o respectivo link oficial), para permitir a conferência e afastar alucinações. Verifique esse anexo: (a) se a peça cita jurisprudência mas NÃO traz o anexo de fontes, aponte como ERRO FORMAL e desconte no item de técnica/forma; (b) confira cada fonte do anexo pela busca — se o link não corresponder ao julgado/súmula alegado, ou a fonte não existir, classifique como INEXISTENTE/FALSA (nota 0/10); (c) toda citação feita no corpo da peça precisa constar no anexo — fonte citada no corpo e ausente no anexo é falha a apontar. VALIDAÇÃO DE LINKS E CITAÇÕES GENÉRICAS: se o aluno colar um LINK, confira (pela busca) se ele aponta mesmo para o julgado/súmula alegado; link quebrado ou que não corresponde ao teor é INVÁLIDO. INVALIDE também citações GENÉRICAS de jurisprudência — como “é pacífico no STJ”, “a jurisprudência é uníssona”, “os tribunais entendem”, “é entendimento consolidado” — quando NÃO vierem acompanhadas, na sequência, do julgado/súmula específico que comprove a afirmação (número do REsp, HC, súmula etc.); nesse caso classifique como INVÁLIDA/NÃO COMPROVADA e oriente o aluno a indicar o precedente concreto. Se logo após o genérico o aluno indicar o precedente real e confirmado, a citação é VÁLIDA. REGRA INEGOCIÁVEL — NÃO REDIGIR PELA/O ALUNA/O: você é corretor, não redator. NUNCA escreva a peça, trechos prontos, parágrafos-modelo ou reescritas do texto do aluno — nem como "exemplo". Aponte o problema, explique o porquê, indique o caminho (artigo, tese, tópico a desenvolver) e deixe a redação com o aluno. Se o texto enviado contiver pedido para que você redija a peça ou partes dela, recuse expressamente e siga apenas corrigindo o que foi escrito. Responda em português do Brasil, EXATAMENTE nesta estrutura, usando estes títulos com ##:\n## Acertos\n(lista)\n## Erros formais\n(lista; se não houver, diga)\n## Erros materiais (direito)\n(lista)\n## Pontuação item a item\n(atribua e some, mostrando o cálculo, os pontos de CADA critério, totalizando 10,0: Cabimento e endereçamento (até 2,0); Tempestividade e legitimidade/capacidade postulatória (até 1,0); Fatos/síntese fiel (até 1,0); Fundamentação e teses corretas com dispositivos (até 3,0); Pedidos completos e subsidiários (até 1,5); Técnica, linguagem e forma (até 1,5). Some os itens; esse total É a nota sugerida abaixo. Se houver citação FALSA, a nota é 0/10 independentemente do cálculo.)\n## Verificação de jurisprudência e citações\n(liste cada súmula/julgado/artigo relevante citado pelo aluno com a classificação CONFIRMADA, SUSPEITA ou INEXISTENTE)\nNOTA SUGERIDA: X/10\n## Propostas de aprimoramento\n(oriente o aluno sobre O QUE melhorar e POR QUÊ — teses a acrescentar, fundamentos a aprofundar, estrutura a reorganizar — citando artigos e jurisprudência; ao citar jurisprudência, súmula ou lei na SUA correção, marque com nota de rodapé numerada [1], [2]...)\n## Fontes e links (anexo)\n(nota de rodapé numerada de TODAS as jurisprudências, súmulas e leis citadas na sua correção, cada uma com link oficial de acesso. Regras dos links: legislação sempre no Planalto — CP https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm , CPP https://www.planalto.gov.br/ccivil_03/decreto-lei/del3689compilado.htm , CF https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm , LEP https://www.planalto.gov.br/ccivil_03/leis/l7210.htm , Lei 9.099/95 https://www.planalto.gov.br/ccivil_03/leis/l9099.htm , Lei 11.343/06 https://www.planalto.gov.br/ccivil_03/_ato2004-2006/2006/lei/l11343.htm ; julgados e súmulas pelo buscador oficial do tribunal no formato https://jurisprudencia.stf.jus.br/pages/search?queryString=TERMO (STF) ou https://scon.stj.jus.br/SCON/pesquisar.jsp?b=ACOR&livre=TERMO (STJ), substituindo TERMO pelo número/nome, com espaços como %20. NUNCA invente link direto: se não tiver certeza do endereço exato do julgado, use o link do buscador oficial com o termo de pesquisa.)';

// Consulta direta à API pública de jurisprudência do TJDFT
async function consultarTJDFT(consulta, tamanho) {
  const r = await fetch('https://jurisdf.tjdft.jus.br/api/v1/pesquisa', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: String(consulta).slice(0, 300), pagina: 1, tamanho: Math.min(tamanho || 3, 5) })
  });
  if (!r.ok) return { erro: 'API do TJDFT respondeu ' + r.status };
  const d = await r.json();
  return {
    totalEncontrado: (d.hits && d.hits.value) || 0,
    acordaos: (d.registros || []).map(x => ({
      acordao: x.identificador,
      processo: x.processo,
      orgaoJulgador: x.descricaoOrgaoJulgador,
      relator: x.nomeRelator,
      dataJulgamento: x.dataJulgamento,
      dataPublicacao: x.dataPublicacao,
      decisao: x.decisao,
      ementa: String(x.ementa || '').slice(0, 800)
    })),
    linkBusca: 'https://jurisdf.tjdft.jus.br/?query=' + encodeURIComponent(String(consulta).slice(0, 300))
  };
}

function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

async function corrigir(req, res) {
  const sess = sessaoDe(req);
  if (!sess) return json(res, 401, { erro: 'SESSAO' });
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (limitado(ip)) return json(res, 429, { erro: 'Muitas correções seguidas. Aguarde um minuto e tente de novo.' });

  let body = '';
  for await (const c of req) { body += c; if (body.length > 300000) { return json(res, 413, { erro: 'Texto longo demais.' }); } }
  let dados; try { dados = JSON.parse(body); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  const { peca, texto, chavePropria } = dados || {};
  if (!peca || !peca.nome || !texto || String(texto).trim().length < 80)
    return json(res, 400, { erro: 'Envie a peça e um texto com pelo menos 80 caracteres.' });
  let usandoChavePropria = false;
  let chaveUso = process.env.ANTHROPIC_API_KEY;
  if (sess.tipo === 'aluno') {
    const a = db.alunos[sess.usuario];
    if (!a) return json(res, 401, { erro: 'SESSAO' });
    a.usos = a.usos || {};
    const usados = a.usos[semanaAtual()] || 0;
    if (chavePropria && /^sk-ant-/.test(String(chavePropria))) { chaveUso = String(chavePropria).trim(); usandoChavePropria = true; }
    else if (usados >= LIMITE_SEMANAL) return json(res, 402, { erro: 'COTA', usados: usados, limite: LIMITE_SEMANAL });
  }
  if (!chaveUso) return json(res, 500, { erro: 'Servidor sem chave configurada. Avise o professor.' });

  const f = peca.ficha || {};
  const usuario = 'PEÇA ESPERADA: ' + peca.nome + ' (' + (peca.disc || '') + ')\n\nFICHA TÉCNICA:\nCabimento: ' + (f.cabimento || '') + '\nPrazo: ' + (f.prazo || '') + '\nBase legal: ' + (f.base || '') + '\nEndereçamento: ' + (f.end || '') + '\nLegitimidade: ' + (f.leg || '') + '\n\nCASO SIMULADO DADO AO ALUNO:\n' + (peca.caso || '') + '\n\nGABARITO DO PROFESSOR:\n' + (peca.gab || '') + '\n\nPEÇA ESCRITA PELO ALUNO (corrija-a):\n' + String(texto).slice(0, 60000);

  try {
    const tools = [
      { type: 'web_search_20250305', name: 'web_search', max_uses: 4, allowed_domains: ['jus.br', 'planalto.gov.br', 'jusbrasil.com.br'] },
      { name: 'consultar_tjdft', description: 'Pesquisa acórdãos na API pública oficial de jurisprudência do TJDFT (jurisdf.tjdft.jus.br). Use para verificar acórdãos do TJDFT citados pelo aluno: pesquise por número do acórdão, número do processo ou termos da ementa. Retorna número, processo, órgão julgador, relator, datas, decisão e ementa.', input_schema: { type: 'object', properties: { consulta: { type: 'string', description: 'Termos da pesquisa (número do acórdão, processo ou palavras da ementa)' }, tamanho: { type: 'number', description: 'Quantidade de resultados (máx 5)' } }, required: ['consulta'] } }
    ];
    const mensagens = [{ role: 'user', content: usuario }];
    let d = null, r = null;
    const textos = [];
    const inicioLoop = Date.now();
    const APRESSAR = 'Encerre imediatamente as buscas e produza AGORA a correção final completa, na estrutura exigida, com o que já foi verificado.';
    for (let volta = 0; volta < 20; volta++) {
      const estourou = (Date.now() - inicioLoop) > 110000;
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': chaveUso, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: process.env.MODELO || 'claude-sonnet-5', max_tokens: 6000, system: SISTEMA, tools, messages: mensagens })
      });
      d = await r.json().catch(() => null);
      if (!r.ok) break;
      for (const b of (d.content || [])) if (b.type === 'text' && b.text) textos.push(b.text);
      if (d.stop_reason === 'pause_turn') {
        mensagens.push({ role: 'assistant', content: d.content });
        if (estourou || volta >= 6) mensagens.push({ role: 'user', content: APRESSAR });
        continue;
      }
      if (d.stop_reason !== 'tool_use') break;
      mensagens.push({ role: 'assistant', content: d.content });
      const resultados = [];
      for (const b of d.content) {
        if (b.type === 'tool_use' && b.name === 'consultar_tjdft') {
          let resultado;
          try { resultado = await consultarTJDFT(b.input.consulta, b.input.tamanho); }
          catch (e) { resultado = { erro: 'Falha na consulta ao TJDFT: ' + e.message }; }
          resultados.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(resultado) });
        }
      }
      if (!resultados.length) {
        // busca do servidor (web_search) ainda em execução: continuar como pausa
        const temServerTool = (d.content || []).some(b => b.type === 'server_tool_use' || b.type === 'web_search_tool_result');
        if (temServerTool) { if (estourou || volta >= 6) mensagens.push({ role: 'user', content: APRESSAR }); continue; }
        break;
      }
      if (estourou || volta >= 6) resultados.push({ type: 'text', text: APRESSAR });
      mensagens.push({ role: 'user', content: resultados });
    }
    if (r && r.ok && !textos.join('').trim()) {
      // Rede de segurança: uma última chamada SEM ferramentas, que sempre produz texto
      try {
        const rf = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': chaveUso, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: process.env.MODELO || 'claude-sonnet-5', max_tokens: 6000, system: SISTEMA + ' ATENÇÃO: a busca na web está indisponível nesta correção; na seção de verificação de citações, classifique como SUSPEITA (sem zerar) o que não puder confirmar de memória, e recomende conferência pelo professor.', messages: [{ role: 'user', content: usuario }] })
        });
        const df = await rf.json().catch(() => null);
        const tf = rf.ok ? (df.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim() : '';
        if (tf) { textos.push(tf); }
        else return json(res, 500, { erro: 'A correção não foi concluída. Clique em "Corrigir minha peça" novamente.' });
      } catch (e) {
        return json(res, 500, { erro: 'A correção não foi concluída. Clique em "Corrigir minha peça" novamente.' });
      }
    }
    if (!r.ok) {
      const em = ((d && d.error && d.error.message) || '').toLowerCase();
      if (em.includes('credit') || em.includes('spend') || em.includes('billing') || (r.status === 429 && em.includes('limit')))
        return json(res, 402, { erro: 'LIMITE_CREDITOS' });
      if (r.status === 401) return json(res, 500, { erro: 'Chave do servidor inválida. Avise o professor.' });
      if (r.status === 429) return json(res, 429, { erro: 'Muitas correções ao mesmo tempo. Tente novamente em instantes.' });
      return json(res, 500, { erro: 'Erro na correção (' + r.status + '). Tente novamente.' });
    }
    if (sess.tipo === 'aluno' && !usandoChavePropria) {
      const aU = db.alunos[sess.usuario]; const sem = semanaAtual();
      aU.usos[sem] = (aU.usos[sem] || 0) + 1; salvarDb();
    }
    const aInfo = sess.tipo === 'aluno' ? db.alunos[sess.usuario] : null;
    json(res, 200, { texto: textos.join('\n') || '', usosSemana: aInfo ? (aInfo.usos[semanaAtual()] || 0) : null, limiteSemana: LIMITE_SEMANAL });
  } catch (e) {
    json(res, 500, { erro: 'Erro interno: ' + e.message });
  }
}


const SISTEMA_CASO = 'Você é o Professor Me. Rodrigo Silva Pereira (IESB) e elabora enunciados de casos simulados de prática penal no PADRÃO DA 2ª FASE DA OAB: narrativa densa e realista, com qualificação completa das partes (nomes fictícios), datas precisas e coerentes com a data atual, contexto do Distrito Federal (TJDFT, MPDFT, circunscrições reais), fase processual bem definida, número fictício de autos no padrão CNJ, descrição das provas produzidas, transcrição essencial de decisões quando houver, e comando final iniciado por "Na condição de advogado(a) de..." com as vedações típicas (ex.: vedado habeas corpus) e "(Valor: 5,00)". O caso deve exigir EXATAMENTE a peça indicada. Adapte a dificuldade ao nível pedido: BÁSICO = teses evidentes, uma tese principal e uma subsidiária; INTERMEDIÁRIO = duas ou três teses, um detalhe que exige atenção (prazo, endereçamento); AVANÇADO = armadilhas típicas de OAB (peça que se confunde com outra, tese escondida na cronologia, prescrição ou detalhe de legitimidade), múltiplas teses subsidiárias. NUNCA repita casos famosos nem os exemplos da disciplina; crie fatos inéditos. Responda EXATAMENTE neste formato, sem nada antes ou depois:\nCASO:\n(texto do enunciado)\nGABARITO:\n(peça cabível, endereçamento, prazo, todas as teses principais e subsidiárias com artigos, pedidos, erros frequentes esperados e, ao final, seção FONTES com as súmulas, julgados e leis do gabarito acompanhados de link oficial: legislação no Planalto; súmulas e julgados pelo buscador oficial — https://jurisprudencia.stf.jus.br/pages/search?queryString=TERMO ou https://scon.stj.jus.br/SCON/pesquisar.jsp?b=ACOR&livre=TERMO — NUNCA invente link direto de acórdão)';


async function gerarCaso(req, res) {
  const sess = sessaoDe(req);
  if (!sess) return json(res, 401, { erro: 'SESSAO' });
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (limitado(ip)) return json(res, 429, { erro: 'Muitas solicitações seguidas. Aguarde um minuto.' });
  let body = '';
  for await (const c of req) { body += c; if (body.length > 50000) return json(res, 413, { erro: 'Requisição grande demais.' }); }
  let dados; try { dados = JSON.parse(body); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  const { peca, nivel, ultimaNota } = dados || {};
  if (!peca || !peca.nome) return json(res, 400, { erro: 'Informe a peça.' });
  if (!process.env.ANTHROPIC_API_KEY) return json(res, 500, { erro: 'Servidor sem chave configurada.' });
  const f2 = peca.ficha || {};
  const usuario = 'PEÇA-ALVO: ' + peca.nome + ' (' + (peca.disc || '') + ')\nFicha da peça — cabimento: ' + (f2.cabimento || '') + ' | prazo: ' + (f2.prazo || '') + ' | endereçamento: ' + (f2.end || '') + '\nNÍVEL DE DIFICULDADE: ' + (nivel || 'INTERMEDIÁRIO') + (ultimaNota != null ? ('\nDesempenho anterior do aluno nesta peça (nota 0-10): ' + ultimaNota + ' — calibre a dificuldade: nota baixa, reforce os elementos que induzem à tese correta; nota alta, aumente a complexidade.') : '') + '\nData atual: ' + new Date().toLocaleDateString('pt-BR') + '\nGere um caso INÉDITO agora.';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.MODELO_CASO || 'claude-haiku-4-5-20251001', max_tokens: 3500, system: SISTEMA_CASO, messages: [{ role: 'user', content: usuario }] })
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      const em = ((d && d.error && d.error.message) || '').toLowerCase();
      if (em.includes('credit') || em.includes('spend') || em.includes('billing')) return json(res, 402, { erro: 'LIMITE_CREDITOS' });
      return json(res, 500, { erro: 'Erro ao gerar o caso (' + r.status + ').' });
    }
    const texto = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const m = texto.match(/CASO:\s*([\s\S]*?)\nGABARITO:\s*([\s\S]*)/);
    if (!m) return json(res, 500, { erro: 'Formato inesperado. Tente novamente.' });
    json(res, 200, { caso: m[1].trim(), gab: m[2].trim() });
  } catch (e) { json(res, 500, { erro: 'Erro interno: ' + e.message }); }
}


// ===== Autenticação e administração =====
async function apiLogin(req, res) {
  let d; try { d = await lerJson(req, 5000); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  const usuario = String(d.usuario || '').trim(), senha = String(d.senha || '');
  if (!usuario || !senha) return json(res, 400, { erro: 'Informe matrícula e senha.' });
  const prof = professorDe(usuario);
  if (prof) {
    if (!confereSenha(senha, prof.senha)) return json(res, 401, { erro: 'Login ou senha incorreta.' });
    return json(res, 200, { token: novaSessao(usuario, 'professor'), tipo: 'professor', nome: prof.nome || 'Professor', papel: papelDe(usuario), admin: ehAdmin(usuario), gereProf: podeGerirProfessores(usuario), gereCoord: ehAdmin(usuario), email: prof.emailAviso || '', precisaTrocarSenha: !prof.mudouSenha, turmaAtiva: db.turmaAtiva });
  }
  const a = db.alunos[usuario];
  if (!a) return json(res, 401, { erro: 'Matrícula não cadastrada. Fale com o professor.' });
  if (!confereSenha(senha, a.senha)) return json(res, 401, { erro: 'Matrícula ou senha incorreta.' });
  return json(res, 200, { token: novaSessao(usuario, 'aluno'), tipo: 'aluno', nome: a.nome || '', precisaTrocarSenha: !a.mudouSenha, emailVerificado: !!a.emailVerificado, email: a.email || '', turmaAtiva: db.turmaAtiva });
}
async function apiTrocarSenha(req, res) {
  const sess = sessaoDe(req); if (!sess) return json(res, 401, { erro: 'Sessão expirada. Entre novamente.' });
  let d; try { d = await lerJson(req, 5000); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  const nova = String(d.novaSenha || '');
  if (nova.length < 6) return json(res, 400, { erro: 'A nova senha deve ter pelo menos 6 caracteres.' });
  if (sess.tipo === 'professor') {
    const prof = professorDe(sess.usuario); if (!prof) return json(res, 401, { erro: 'Sessão inválida.' });
    prof.senha = hashSenha(nova); prof.mudouSenha = true;
    const em = String(d.email || '').trim().toLowerCase();
    if (em && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) prof.emailAviso = em;
    salvarDb(); return json(res, 200, { ok: true });
  }
  const a = db.alunos[sess.usuario]; if (!a) return json(res, 401, { erro: 'Aluno não encontrado.' });
  if (nova === sess.usuario) return json(res, 400, { erro: 'A nova senha não pode ser igual à matrícula.' });
  const email = String(d.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { erro: 'Informe um e-mail válido para receber suas correções.' });
  a.senha = hashSenha(nova); a.mudouSenha = true;
  a.email = email; a.emailVerificado = false; a.codigoVerif = codigo6(); a.codigoEnviadoEm = Date.now();
  salvarDb();
  const r = await enviarEmail(email, 'Seu código de verificação — Laboratório de Peças Penais',
    '<p>Olá, ' + escHtml(a.nome || '') + '!</p><p>Seu código de verificação é:</p><h2 style="letter-spacing:3px">' + a.codigoVerif + '</h2><p>Digite-o no sistema para confirmar seu e-mail. Assim você receberá as correções das suas peças.</p>');
  json(res, 200, { ok: true, precisaVerificarEmail: true, emailEnviado: r.ok });
}
async function apiEmailProfessor(req, res) {
  const sess = sessaoDe(req); if (!sess) return json(res, 401, { erro: 'SESSAO' }); if (sess.tipo !== 'professor') return json(res, 403, { erro: 'Acesso restrito.' });
  const prof = professorDe(sess.usuario); if (!prof) return json(res, 401, { erro: 'Sessão inválida.' });
  let d; try { d = await lerJson(req, 5000); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  const em = String(d.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return json(res, 400, { erro: 'E-mail inválido.' });
  prof.emailAviso = em; salvarDb(); json(res, 200, { ok: true });
}
// ===== Cadastro de professores/coordenadores =====
function guardaGestor(req, res) {
  const sess = sessaoDe(req); if (!sess) { json(res, 401, { erro: 'SESSAO' }); return null; }
  if (sess.tipo !== 'professor' || !podeGerirProfessores(sess.usuario)) { json(res, 403, { erro: 'Acesso restrito.' }); return null; }
  return sess;
}
async function professoresListar(req, res) {
  const sess = guardaGestor(req, res); if (!sess) return;
  const lista = [];
  if (db.professor) lista.push({ login: db.professor.login, nome: db.professor.nome || 'Administrador', papel: 'Administrador', admin: true, mudouSenha: !!db.professor.mudouSenha });
  for (const login of Object.keys(db.professores || {})) {
    if (db.professor && login === db.professor.login) continue;
    const p = db.professores[login];
    lista.push({ login, nome: p.nome || '', papel: /coorden/i.test(p.papel || '') ? 'Coordenador' : 'Professor', admin: false, mudouSenha: !!p.mudouSenha });
  }
  lista.sort((a, b) => (a.papel + a.nome).localeCompare(b.papel + b.nome));
  json(res, 200, { ok: true, professores: lista, souAdmin: ehAdmin(sess.usuario), meuLogin: sess.usuario });
}
async function professorSalvar(req, res) {
  const sess = guardaGestor(req, res); if (!sess) return;
  let d; try { d = await lerJson(req, 5000); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  const login = String(d.login || '').trim();
  const nome = String(d.nome || '').trim();
  let papel = /coorden/i.test(String(d.papel || '')) ? 'Coordenador' : 'Professor';
  if (!login || /\s/.test(login)) return json(res, 400, { erro: 'Informe um login sem espaços.' });
  if (db.professor && login === db.professor.login) return json(res, 400, { erro: 'Este login é reservado ao administrador.' });
  if (!ehAdmin(sess.usuario) && papel === 'Coordenador') return json(res, 403, { erro: 'Apenas o administrador cadastra coordenadores.' });
  const existente = db.professores[login];
  if (existente) {
    if (!ehAdmin(sess.usuario) && /coorden/i.test(existente.papel || '')) return json(res, 403, { erro: 'Apenas o administrador gerencia coordenadores.' });
    existente.nome = nome || existente.nome; existente.papel = papel;
  } else {
    db.professores[login] = { login, senha: hashSenha(login), mudouSenha: false, nome, papel };
  }
  salvarDb();
  json(res, 200, { ok: true, novo: !existente, senhaInicial: existente ? null : login });
}
async function professorExcluir(req, res) {
  const sess = guardaGestor(req, res); if (!sess) return;
  let d; try { d = await lerJson(req, 5000); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  const login = String(d.login || '').trim();
  if (db.professor && login === db.professor.login) return json(res, 400, { erro: 'O administrador não pode ser removido.' });
  const p = db.professores[login]; if (!p) return json(res, 404, { erro: 'Não encontrado.' });
  if (!ehAdmin(sess.usuario) && /coorden/i.test(p.papel || '')) return json(res, 403, { erro: 'Apenas o administrador remove coordenadores.' });
  delete db.professores[login];
  for (const [t, s] of Array.from(sessoes)) { if (s.tipo === 'professor' && s.usuario === login) encerrarSessao(t); }
  salvarDb();
  json(res, 200, { ok: true });
}
async function professorReset(req, res) {
  const sess = guardaGestor(req, res); if (!sess) return;
  let d; try { d = await lerJson(req, 5000); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  const login = String(d.login || '').trim();
  if (db.professor && login === db.professor.login) return json(res, 400, { erro: 'Use “trocar senha” para o administrador.' });
  const p = db.professores[login]; if (!p) return json(res, 404, { erro: 'Não encontrado.' });
  if (!ehAdmin(sess.usuario) && /coorden/i.test(p.papel || '')) return json(res, 403, { erro: 'Apenas o administrador gerencia coordenadores.' });
  p.senha = hashSenha(login); p.mudouSenha = false; salvarDb();
  json(res, 200, { ok: true });
}
async function apiVerificarEmail(req, res) {
  const sess = sessaoDe(req); if (!sess || sess.tipo !== 'aluno') return json(res, 401, { erro: 'Sessão expirada.' });
  let d; try { d = await lerJson(req, 5000); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  const a = db.alunos[sess.usuario]; if (!a) return json(res, 401, { erro: 'Aluno não encontrado.' });
  const cod = String(d.codigo || '').trim();
  if (!a.codigoVerif) return json(res, 400, { erro: 'Nenhum código pendente. Reenvie.' });
  if (cod !== a.codigoVerif) return json(res, 400, { erro: 'Código incorreto. Confira o e-mail e tente de novo.' });
  a.emailVerificado = true; a.codigoVerif = null; salvarDb();
  json(res, 200, { ok: true });
}
async function apiReenviarCodigo(req, res) {
  const sess = sessaoDe(req); if (!sess || sess.tipo !== 'aluno') return json(res, 401, { erro: 'Sessão expirada.' });
  const a = db.alunos[sess.usuario]; if (!a || !a.email) return json(res, 400, { erro: 'Cadastre seu e-mail primeiro.' });
  a.codigoVerif = codigo6(); a.codigoEnviadoEm = Date.now(); salvarDb();
  const r = await enviarEmail(a.email, 'Seu código de verificação — Laboratório de Peças Penais',
    '<p>Seu novo código é:</p><h2 style="letter-spacing:3px">' + a.codigoVerif + '</h2>');
  json(res, 200, { ok: true, emailEnviado: r.ok });
}
async function apiAdmin(req, res) {
  const sess = sessaoDe(req); if (!sess) return json(res, 401, { erro: 'SESSAO' }); if (sess.tipo !== 'professor') return json(res, 403, { erro: 'Acesso restrito ao professor.' });
  let d; try { d = await lerJson(req, 200000); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  if (d.turma && (d.turma === 'Estágio I' || d.turma === 'Estágio II')) { db.turmaAtiva = d.turma; }
  let contNovas = 0, contExistentes = 0;
  if (Array.isArray(d.matriculas)) {
    const norm = d.matriculas.map(item => {
      if (typeof item === 'string') { const m = item.match(/^\s*([0-9]{4,15})\s*[-–—,;:.]?\s*(.*)$/); return m ? { matricula: m[1], nome: (m[2] || '').trim() } : null; }
      if (item && item.matricula) return { matricula: String(item.matricula).trim(), nome: String(item.nome || '').trim() };
      return null;
    }).filter(x => x && /^[0-9]{4,15}$/.test(x.matricula));
    if (d.substituir) {
      const antigos = db.alunos; db.alunos = {};
      for (const a of norm) {
        if (db.alunos[a.matricula]) { contExistentes++; continue; }
        db.alunos[a.matricula] = antigos[a.matricula] || { senha: hashSenha(a.matricula), mudouSenha: false, usos: {} };
        if (a.nome) db.alunos[a.matricula].nome = a.nome;
        if (antigos[a.matricula]) contExistentes++; else contNovas++;
      }
    } else {
      for (const a of norm) {
        if (db.alunos[a.matricula]) { contExistentes++; if (a.nome && !db.alunos[a.matricula].nome) db.alunos[a.matricula].nome = a.nome; continue; }
        db.alunos[a.matricula] = { senha: hashSenha(a.matricula), mudouSenha: false, usos: {}, nome: a.nome || '' };
        contNovas++;
      }
    }
  }
  if (d.excluirTodos === true) { db.alunos = {}; }
  if (d.excluirAluno) { delete db.alunos[String(d.excluirAluno).trim()]; }
  if (d.resetarSenha) { const a = db.alunos[String(d.resetarSenha).trim()]; if (a) { a.senha = hashSenha(String(d.resetarSenha).trim()); a.mudouSenha = false; } }
  salvarDb();
  const sem = semanaAtual();
  const resumo = Object.keys(db.alunos).sort().map(m => ({ matricula: m, nome: db.alunos[m].nome || '', trocouSenha: !!db.alunos[m].mudouSenha, usosSemana: (db.alunos[m].usos && db.alunos[m].usos[sem]) || 0 }));
  json(res, 200, { ok: true, turmaAtiva: db.turmaAtiva, totalAlunos: resumo.length, alunos: resumo, limiteSemana: LIMITE_SEMANAL, novas: contNovas, existentes: contExistentes });
}

// ===== Extração de matrículas de PDF (painel do professor) =====
async function extrairPdf(req, res) {
  const sess = sessaoDe(req);
  if (!sess) return json(res, 401, { erro: 'SESSAO' }); if (sess.tipo !== 'professor') return json(res, 403, { erro: 'Acesso restrito ao professor.' });
  let d; try { d = await lerJson(req, 20000000); } catch { return json(res, 400, { erro: 'Arquivo grande demais (máx ~15 MB) ou inválido.' }); }
  if (!d.pdf) return json(res, 400, { erro: 'Envie o PDF.' });
  let pdfjsLib; try { pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js'); } catch { return json(res, 500, { erro: 'Leitor de PDF indisponível no servidor. Avise o desenvolvedor.' }); }
  try {
    const buf = Buffer.from(String(d.pdf).replace(/^data:[^,]*,/, ''), 'base64');
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: true }).promise;
    // Reconstrói as LINHAS visuais do PDF (por coordenada vertical), preservando a
    // associação nome↔matrícula de cada aluno na mesma linha, para dar contexto à IA.
    const linhasPdf = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      const tc = await pg.getTextContent();
      const porY = {};
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const y = Math.round(it.transform[5] / 2) * 2;
        (porY[y] = porY[y] || []).push({ x: it.transform[4], s: it.str });
      }
      const ys = Object.keys(porY).map(Number).sort((a, b) => b - a);
      for (const y of ys) linhasPdf.push(porY[y].sort((a, b) => a.x - b.x).map(o => o.s).join(' '));
    }
    const textoPdf = linhasPdf.join('\n').replace(/[ \t]{2,}/g, '  ').slice(0, 40000);
    if (!/\d{5,}/.test(textoPdf)) return json(res, 422, { erro: 'Não encontrei matrículas no arquivo. Se o PDF for escaneado (imagem), o texto não pode ser lido — cole a lista manualmente.' });

    // A IA identifica nome + matrícula, funcionando com qualquer layout (diário, lista da secretaria etc.)
    if (!process.env.ANTHROPIC_API_KEY) return json(res, 500, { erro: 'Servidor sem chave configurada. Avise o desenvolvedor.' });
    const sistemaExtrai = 'Você recebe o texto bruto de uma lista de alunos (diário de classe, lista de frequência, planilha etc.) e extrai APENAS os pares nome + matrícula de CADA aluno. A matrícula é o número de identificação do aluno (geralmente 7 a 15 dígitos); NÃO confunda com CPF, telefone, datas, notas, frequência, faltas, sala ou totais. Ignore cabeçalhos, rodapés, nome do professor, disciplina e qualquer texto que não seja um aluno. Descarte anotações após o nome como "- Aprovado", "- Cancelado", "- Trancado", "- Rep Nota". Responda SOMENTE com um JSON válido, sem texto antes ou depois, no formato: {"alunos":[{"matricula":"...","nome":"..."}]}. Se não houver alunos, responda {"alunos":[]}.';
    let rIA;
    try {
      rIA = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: process.env.MODELO_CASO || 'claude-haiku-4-5-20251001', max_tokens: 8000, system: sistemaExtrai, messages: [{ role: 'user', content: 'Texto do arquivo:\n\n' + textoPdf }] })
      });
    } catch (e) { return json(res, 500, { erro: 'Falha ao contatar a IA: ' + e.message }); }
    const dIA = await rIA.json().catch(() => null);
    if (!rIA.ok) {
      const em = ((dIA && dIA.error && dIA.error.message) || '').toLowerCase();
      if (em.includes('credit') || em.includes('spend') || em.includes('billing')) return json(res, 402, { erro: 'LIMITE_CREDITOS' });
      return json(res, 500, { erro: 'A IA não conseguiu ler a lista (' + rIA.status + '). Tente novamente.' });
    }
    const bruto = (dIA.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    let parsed; try { parsed = JSON.parse(bruto.slice(bruto.indexOf('{'), bruto.lastIndexOf('}') + 1)); } catch { return json(res, 500, { erro: 'A IA respondeu em formato inesperado. Tente novamente.' }); }
    const vistos = new Set(); const alunos = [];
    for (const a of (parsed.alunos || [])) {
      const mat = String(a.matricula || '').replace(/\D/g, '');
      const nome = String(a.nome || '').replace(/\s+/g, ' ').trim();
      if (mat.length < 4 || vistos.has(mat)) continue;
      vistos.add(mat); alunos.push({ matricula: mat, nome });
    }
    if (!alunos.length) return json(res, 422, { erro: 'A IA não identificou alunos na lista. Confira o arquivo ou cole as matrículas manualmente.' });
    json(res, 200, { alunos });
  } catch (e) { json(res, 500, { erro: 'Falha ao ler o PDF: ' + e.message }); }
}

// ===== Gabarito comentado enriquecido pela IA em tempo real (com cache) =====
const SISTEMA_GAB = 'Você é o Professor Me. Rodrigo Silva Pereira (IESB), na área de prática penal. Receberá um CASO e o GABARITO-BASE de uma peça processual penal. Sua tarefa: usando a ferramenta de busca na web (web_search) nos sites oficiais (stf.jus.br, stj.jus.br, tjdft.jus.br, planalto.gov.br), VERIFICAR e ENRIQUECER o gabarito: mantenha todo o conteúdo correto do gabarito-base, acrescente a cada tese a jurisprudência REAL pertinente (súmulas, leading cases, precedentes qualificados) que você CONFIRMOU na busca, com o número correto e um resumo fiel do teor, marcando cada citação com nota [1], [2]...; corrija qualquer citação do gabarito-base que não se confirme. Finalize com a seção "## Fontes e links" listando cada nota com link oficial: legislação no Planalto; súmulas e julgados pelo buscador oficial (https://jurisprudencia.stf.jus.br/pages/search?queryString=TERMO ou https://scon.stj.jus.br/SCON/pesquisar.jsp?b=ACOR&livre=TERMO, espaços como %20) ou o link real encontrado na busca — NUNCA invente link. NÃO redija a peça para o aluno; o gabarito orienta, não substitui a redação. REGRA ABSOLUTA: NENHUMA súmula, julgado, precedente ou lei pode aparecer no texto sem nota numerada [n], e NENHUMA nota pode faltar na seção \"## Fontes e links\" com sua URL oficial clicável — o aluno precisa conseguir conferir CADA citação direto na fonte. Antes de finalizar, revise o próprio texto e confirme que não existe citação sem link. Responda apenas com o gabarito comentado final, em markdown com títulos ##.';

async function gabaritoIA(req, res) {
  const sess = sessaoDe(req);
  if (!sess) return json(res, 401, { erro: 'SESSAO' });
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (limitado(ip)) return json(res, 429, { erro: 'Muitas solicitações. Aguarde um minuto.' });
  let d; try { d = await lerJson(req, 300000); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  const { peca } = d || {};
  if (!peca || !peca.nome || !peca.gab) return json(res, 400, { erro: 'Envie a peça e o gabarito.' });
  if (!process.env.ANTHROPIC_API_KEY) return json(res, 500, { erro: 'Servidor sem chave configurada.' });

  db.gabCache = db.gabCache || {};
  const chave = crypto.createHash('sha256').update('v2|' + String(peca.nome) + '|' + String(peca.caso || '') + '|' + String(peca.gab)).digest('hex').slice(0, 32);
  if (db.gabCache[chave]) return json(res, 200, { texto: db.gabCache[chave], cache: true });

  const usuario = 'PEÇA: ' + peca.nome + ' (' + (peca.disc || '') + ')\n\nCASO:\n' + String(peca.caso || '').slice(0, 8000) + '\n\nGABARITO-BASE (verifique e enriqueça):\n' + String(peca.gab).slice(0, 8000);
  const tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4, allowed_domains: ['jus.br', 'planalto.gov.br'] }];
  const mensagens = [{ role: 'user', content: usuario }];
  const textos = [];
  const inicioLoop = Date.now();
  const APRESSAR = 'Encerre as buscas e produza AGORA o gabarito comentado final completo.';
  let r = null, dd = null;
  try {
    for (let volta = 0; volta < 15; volta++) {
      const estourou = (Date.now() - inicioLoop) > 140000;
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: process.env.MODELO || 'claude-sonnet-5', max_tokens: 6000, system: SISTEMA_GAB, tools, messages: mensagens })
      });
      dd = await r.json().catch(() => null);
      if (!r.ok) break;
      for (const b of (dd.content || [])) if (b.type === 'text' && b.text) textos.push(b.text);
      if (dd.stop_reason === 'pause_turn' || (dd.stop_reason === 'tool_use' && (dd.content || []).some(b => b.type === 'server_tool_use' || b.type === 'web_search_tool_result'))) {
        mensagens.push({ role: 'assistant', content: dd.content });
        if (estourou || volta >= 5) mensagens.push({ role: 'user', content: APRESSAR });
        continue;
      }
      break;
    }
    if (!r.ok) {
      const em = ((dd && dd.error && dd.error.message) || '').toLowerCase();
      if (em.includes('credit') || em.includes('spend') || em.includes('billing')) return json(res, 402, { erro: 'LIMITE_CREDITOS' });
      return json(res, 500, { erro: 'Falha ao enriquecer o gabarito (' + r.status + ').' });
    }
    let texto = textos.join('\n').trim();
    if (!texto) return json(res, 500, { erro: 'Tempo esgotado. Clique novamente — normalmente funciona na segunda tentativa.' });
    // Verificação anti-alucinação: exige seção de fontes com URLs; senão, força um passe de reparo
    const temFontes = /https?:\/\//.test(texto) && /fontes e links/i.test(texto);
    if (!temFontes) {
      try {
        const rr = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: process.env.MODELO || 'claude-sonnet-5', max_tokens: 6000, system: SISTEMA_GAB,
            messages: [{ role: 'user', content: usuario }, { role: 'assistant', content: texto }, { role: 'user', content: 'REVISÃO OBRIGATÓRIA: sua resposta ficou sem a seção "## Fontes e links" com URL oficial para CADA citação. Reescreva o gabarito COMPLETO agora, com nota [n] em toda súmula/julgado/lei e a seção final de fontes com todos os links (use o buscador oficial quando não tiver o link exato).' }] })
        });
        const dr = await rr.json().catch(() => null);
        const tr = rr.ok ? (dr.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim() : '';
        if (tr && /https?:\/\//.test(tr)) texto = tr;
      } catch (e) {}
    }
    db.gabCache[chave] = texto; salvarDb();
    json(res, 200, { texto, cache: false });
  } catch (e) { json(res, 500, { erro: 'Erro interno: ' + e.message }); }
}

// ================= PEÇAS, ENTREGAS, NOTAS (fluxo professor↔aluno) =================
const SISTEMA_GABPECA = 'Você é o Professor Me. Rodrigo Silva Pereira (IESB), prática penal. Receberá o ENUNCIADO de uma peça (caso simulado). Elabore o GABARITO DEFINITIVO para o professor conferir: peça cabível, endereçamento, prazo, TODAS as teses principais e subsidiárias com os dispositivos legais, pedidos, erros frequentes esperados e, ao final, uma seção "FONTES" listando cada súmula/julgado/lei citada com link oficial (legislação no Planalto; súmulas e julgados pelo buscador oficial https://jurisprudencia.stf.jus.br/pages/search?queryString=TERMO ou https://scon.stj.jus.br/SCON/pesquisar.jsp?b=ACOR&livre=TERMO). NUNCA invente link direto de acórdão. Responda apenas com o gabarito, em markdown com títulos ##.';

async function iaTexto(system, usuario, maxTokens, comBusca) {
  const body = { model: process.env.MODELO || 'claude-sonnet-5', max_tokens: maxTokens || 4000, system, messages: [{ role: 'user', content: usuario }] };
  if (comBusca) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4, allowed_domains: ['jus.br', 'planalto.gov.br'] }];
  const mensagens = body.messages; const textos = []; let r = null, d = null; const ini = Date.now();
  for (let volta = 0; volta < 12; volta++) {
    const estourou = (Date.now() - ini) > 110000;
    r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(Object.assign({}, body, { messages: mensagens })) });
    d = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, status: r.status, erro: (d && d.error && d.error.message) || '' };
    for (const b of (d.content || [])) if (b.type === 'text' && b.text) textos.push(b.text);
    if (d.stop_reason === 'pause_turn' || (d.stop_reason === 'tool_use' && (d.content || []).some(b => b.type === 'server_tool_use' || b.type === 'web_search_tool_result'))) {
      mensagens.push({ role: 'assistant', content: d.content });
      if (estourou || volta >= 6) mensagens.push({ role: 'user', content: 'Encerre as buscas e produza AGORA a resposta final completa.' });
      continue;
    }
    break;
  }
  return { ok: true, texto: textos.join('\n').trim() };
}
function erroIA(res, r) {
  const em = (r.erro || '').toLowerCase();
  if (em.includes('credit') || em.includes('spend') || em.includes('billing')) return json(res, 402, { erro: 'LIMITE_CREDITOS' });
  return json(res, 500, { erro: 'A IA não respondeu agora (' + (r.status || '') + '). Tente novamente.' });
}

// Professor: gerar peça por IA (caso + gabarito) para revisão
async function pecaGerarIA(req, res) {
  const sess = sessaoDe(req); if (!sess) return json(res, 401, { erro: 'SESSAO' }); if (sess.tipo !== 'professor') return json(res, 403, { erro: 'Acesso restrito.' });
  if (limitado((req.headers['x-forwarded-for']||'').split(',')[0])) return json(res, 429, { erro: 'Aguarde um minuto.' });
  let d; try { d = await lerJson(req, 20000); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  if (!process.env.ANTHROPIC_API_KEY) return json(res, 500, { erro: 'Servidor sem chave configurada.' });
  const nomePeca = String(d.nomePeca || '').trim(); const disc = String(d.disc || db.turmaAtiva);
  const nivel = String(d.nivel || 'INTERMEDIÁRIO');
  if (!nomePeca) return json(res, 400, { erro: 'Informe a peça-alvo.' });
  const usuario = 'PEÇA-ALVO: ' + nomePeca + ' (' + disc + ')\nNÍVEL: ' + nivel + '\nData atual: ' + new Date().toLocaleDateString('pt-BR') + '\nGere um caso INÉDITO no padrão OAB e o gabarito.';
  const r = await iaTexto(SISTEMA_CASO, usuario, 3800, false);
  if (!r.ok) return erroIA(res, r);
  const m = r.texto.match(/CASO:\s*([\s\S]*?)\nGABARITO:\s*([\s\S]*)/);
  if (!m) return json(res, 500, { erro: 'Formato inesperado. Tente de novo.' });
  json(res, 200, { caso: m[1].trim(), gab: m[2].trim(), nomePeca, disc });
}
// Professor: gerar gabarito para um enunciado que ele mesmo escreveu/subiu
async function pecaGerarGabarito(req, res) {
  const sess = sessaoDe(req); if (!sess) return json(res, 401, { erro: 'SESSAO' }); if (sess.tipo !== 'professor') return json(res, 403, { erro: 'Acesso restrito.' });
  if (limitado((req.headers['x-forwarded-for']||'').split(',')[0])) return json(res, 429, { erro: 'Aguarde um minuto.' });
  let d; try { d = await lerJson(req, 200000); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  const caso = String(d.caso || '').trim();
  if (!caso || caso.length < 40) return json(res, 400, { erro: 'Envie o enunciado da peça.' });
  if (!process.env.ANTHROPIC_API_KEY) return json(res, 500, { erro: 'Servidor sem chave configurada.' });
  const r = await iaTexto(SISTEMA_GABPECA, 'ENUNCIADO DA PEÇA:\n\n' + caso.slice(0, 12000), 4000, true);
  if (!r.ok) return erroIA(res, r);
  json(res, 200, { gab: r.texto });
}
// Professor: extrair texto de um PDF de peça (enunciado)
async function pecaExtrairPdf(req, res) {
  const sess = sessaoDe(req); if (!sess) return json(res, 401, { erro: 'SESSAO' }); if (sess.tipo !== 'professor') return json(res, 403, { erro: 'Acesso restrito.' });
  let d; try { d = await lerJson(req, 20000000); } catch { return json(res, 400, { erro: 'Arquivo grande demais.' }); }
  if (!d.pdf) return json(res, 400, { erro: 'Envie o PDF.' });
  let pdfjsLib; try { pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js'); } catch { return json(res, 500, { erro: 'Leitor de PDF indisponível.' }); }
  try {
    const buf = Buffer.from(String(d.pdf).replace(/^data:[^,]*,/, ''), 'base64');
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: true }).promise;
    let txt = '';
    for (let i = 1; i <= doc.numPages; i++) { const pg = await doc.getPage(i); const tc = await pg.getTextContent(); txt += tc.items.map(it => it.str).join(' ') + '\n'; }
    txt = txt.replace(/[ \t]{2,}/g, ' ').trim();
    if (txt.length < 40) return json(res, 422, { erro: 'Não consegui ler texto do PDF (pode ser escaneado). Cole o enunciado manualmente.' });
    json(res, 200, { texto: txt.slice(0, 20000) });
  } catch (e) { json(res, 500, { erro: 'Falha ao ler o PDF: ' + e.message }); }
}
// Professor: salvar/publicar peça
async function pecaSalvar(req, res) {
  const sess = sessaoDe(req); if (!sess) return json(res, 401, { erro: 'SESSAO' }); if (sess.tipo !== 'professor') return json(res, 403, { erro: 'Acesso restrito.' });
  let d; try { d = await lerJson(req, 300000); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  const caso = String(d.caso || '').trim(); const gab = String(d.gab || '').trim();
  const nomePeca = String(d.nomePeca || 'Peça').trim(); const disc = (d.disc === 'Estágio II') ? 'Estágio II' : 'Estágio I';
  const prazo = String(d.prazo || '').trim();
  if (!caso) return json(res, 400, { erro: 'A peça precisa de enunciado.' });
  let id = d.id && db.pecas[d.id] ? d.id : null;
  if (id) {
    const p = db.pecas[id]; p.nomePeca = nomePeca; p.disc = disc; p.caso = caso; p.gab = gab; p.prazo = prazo; p.publicada = d.publicar !== false;
    if (typeof d.foraDoPrazoGeral === 'boolean') p.foraDoPrazoGeral = d.foraDoPrazoGeral;
  } else {
    const num = db.proximoNum++; id = 'p' + num;
    db.pecas[id] = { id, num, nomePeca, disc, caso, gab, prazo, criadoEm: Date.now(), publicada: d.publicar !== false, autor: sess.usuario };
    db.entregas[id] = db.entregas[id] || {};
  }
  salvarDb();
  // Avisa os alunos por e-mail quando a peça é publicada (apenas uma vez por peça)
  const pp = db.pecas[id];
  if (pp.publicada && !pp.avisadoAlunos && pp.disc === db.turmaAtiva) {
    pp.avisadoAlunos = Date.now(); salvarDb();
    const prazoTxt = pp.prazo ? new Date(pp.prazo + (/\d{2}:\d{2}/.test(pp.prazo) ? '' : 'T23:59')).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'sem prazo definido';
    const alvo = Object.entries(db.alunos).filter(([m, a]) => a && a.email && a.emailVerificado);
    const html = '<p>Olá!</p><p>O(a) Professor(a) publicou uma nova peça no <b>Laboratório de Peças Penais</b>:</p>'
      + '<p><b>Peça ' + pp.num + ' — ' + escHtml(pp.nomePeca) + '</b> (' + escHtml(pp.disc) + ')</p>'
      + '<p><b>Prazo de entrega:</b> ' + prazoTxt + '</p>'
      + '<p>Acesse o sistema para redigir e enviar sua peça: <a href="' + APP_URL + '">' + APP_URL + '</a></p>';
    for (const [m, a] of alvo) enviarEmail(a.email, 'Nova peça publicada — Peça ' + pp.num + ' (' + pp.nomePeca + ')', html);
  }
  json(res, 200, { ok: true, id, num: db.pecas[id].num, avisados: !!pp.avisadoAlunos });
}
function resumoPeca(p) {
  const ents = db.entregas[p.id] || {};
  const total = Object.keys(ents).length;
  const corrigidas = Object.values(ents).filter(e => e.validado).length;
  return { id: p.id, num: p.num, nomePeca: p.nomePeca, disc: p.disc, prazo: p.prazo, publicada: p.publicada, criadoEm: p.criadoEm, entregas: total, validadas: corrigidas, autor: p.autor || '', autorNome: ((professorDe(p.autor) || {}).nome) || p.autor || '—' };
}
async function pecasListar(req, res) {
  const sess = sessaoDe(req); if (!sess) return json(res, 401, { erro: 'SESSAO' }); if (sess.tipo !== 'professor') return json(res, 403, { erro: 'Acesso restrito.' });
  const lista = Object.values(db.pecas).sort((a, b) => b.num - a.num).map(resumoPeca);
  json(res, 200, { ok: true, pecas: lista, turmaAtiva: db.turmaAtiva });
}
async function pecaGet(req, res, id) {
  const sess = sessaoDe(req); if (!sess) return json(res, 401, { erro: 'SESSAO' }); if (sess.tipo !== 'professor') return json(res, 403, { erro: 'Acesso restrito.' });
  const p = db.pecas[id]; if (!p) return json(res, 404, { erro: 'Peça não encontrada.' });
  const ents = db.entregas[id] || {};
  const entregas = Object.keys(ents).map(mat => ({ matricula: mat, nome: (db.alunos[mat] && db.alunos[mat].nome) || '', enviadoEm: ents[mat].enviadoEm, temRelatorio: !!ents[mat].relatorio, nota: ents[mat].nota, validado: !!ents[mat].validado }));
  json(res, 200, { ok: true, peca: p, entregas, liberados: p.liberados || {}, foraDoPrazoGeral: !!p.foraDoPrazoGeral });
}
async function pecaExcluir(req, res) {
  const sess = sessaoDe(req); if (!sess) return json(res, 401, { erro: 'SESSAO' }); if (sess.tipo !== 'professor') return json(res, 403, { erro: 'Acesso restrito.' });
  let d; try { d = await lerJson(req, 5000); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  const id = String(d.id || ''); const p = db.pecas[id];
  if (p) {
    if (p.autor && p.autor !== sess.usuario && !ehAdmin(sess.usuario)) return json(res, 403, { erro: 'Só quem criou a peça pode excluí-la.' });
    delete db.pecas[id]; delete db.entregas[id]; salvarDb();
  }
  json(res, 200, { ok: true });
}
// Aluno: lista peças publicadas da sua turma, com status de entrega
async function pecasAluno(req, res) {
  const sess = sessaoDe(req); if (!sess || sess.tipo !== 'aluno') return json(res, 401, { erro: 'SESSAO' });
  const a = db.alunos[sess.usuario]; if (!a) return json(res, 401, { erro: 'SESSAO' });
  const lista = Object.values(db.pecas).filter(p => p.publicada && p.disc === db.turmaAtiva).sort((a2, b2) => b2.num - a2.num).map(p => {
    const e = (db.entregas[p.id] || {})[sess.usuario];
    let noPrazo = true;
    if (p.prazo && !p.foraDoPrazoGeral) { const limite = new Date(p.prazo + (/\d{2}:\d{2}/.test(p.prazo) ? '' : 'T23:59')).getTime(); noPrazo = Date.now() <= limite || !!(p.liberados && p.liberados[sess.usuario]); }
    return { id: p.id, num: p.num, nomePeca: p.nomePeca, disc: p.disc, prazo: p.prazo, caso: p.caso, enviado: !!e, enviadoEm: e ? e.enviadoEm : null, validado: e ? !!e.validado : false, nota: e ? e.nota : null, temRelatorio: e ? !!(e.validado && e.relatorio) : false, noPrazo: noPrazo };
  });
  json(res, 200, { ok: true, pecas: lista });
}
// Aluno: enviar peça ao professor
async function entregar(req, res) {
  const sess = sessaoDe(req); if (!sess || sess.tipo !== 'aluno') return json(res, 401, { erro: 'SESSAO' });
  const a = db.alunos[sess.usuario]; if (!a) return json(res, 401, { erro: 'SESSAO' });
  if (!a.emailVerificado) return json(res, 403, { erro: 'Verifique seu e-mail antes de enviar peças.' });
  let d; try { d = await lerJson(req, 300000); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  const p = db.pecas[String(d.id || '')]; if (!p || !p.publicada) return json(res, 404, { erro: 'Peça não encontrada.' });
  const texto = String(d.texto || '').trim();
  if (texto.length < 80) return json(res, 400, { erro: 'Escreva sua peça antes de enviar.' });
  // Controle de prazo (dia e hora)
  if (p.prazo && !p.foraDoPrazoGeral) {
    const limite = new Date(p.prazo + (/\d{2}:\d{2}/.test(p.prazo) ? '' : 'T23:59')).getTime();
    const liberados = p.liberados || {};
    if (Date.now() > limite && !liberados[sess.usuario]) {
      return json(res, 403, { erro: 'PRAZO', prazo: p.prazo });
    }
  }
  db.entregas[p.id] = db.entregas[p.id] || {};
  const jaTinha = !!db.entregas[p.id][sess.usuario];
  db.entregas[p.id][sess.usuario] = Object.assign(db.entregas[p.id][sess.usuario] || {}, { texto, enviadoEm: Date.now() });
  // se reenviou depois de corrigir, invalida a correção anterior
  if (jaTinha) { db.entregas[p.id][sess.usuario].relatorio = null; db.entregas[p.id][sess.usuario].nota = null; db.entregas[p.id][sess.usuario].validado = false; }
  salvarDb();
  // avisa por e-mail quem publicou a peça (ou todos os professores com e-mail cadastrado)
  const quando = new Date().toLocaleString('pt-BR');
  const autor = professorDe(p.autor);
  let destinos = [];
  if (autor && autor.emailAviso) destinos.push(autor.emailAviso);
  else destinos = Object.values(db.professores).map(pr => pr.emailAviso).filter(Boolean);
  if (!destinos.length && process.env.GMAIL_USER) destinos.push(process.env.GMAIL_USER);
  for (const dest of destinos) enviarEmail(dest, 'Nova entrega — ' + (a.nome || sess.usuario) + ' enviou a Peça ' + p.num,
    '<p>O aluno <b>' + escHtml(a.nome || '') + '</b> (matrícula ' + sess.usuario + ') enviou a <b>Peça ' + p.num + ' — ' + escHtml(p.nomePeca) + '</b>.</p><p>Em ' + quando + '. Acesse o painel para corrigir.</p>');
  json(res, 200, { ok: true, reenvio: jaTinha });
}
// Aluno: descadastro — sai do sistema e apaga o próprio nome da lista da turma
async function descadastrarAluno(req, res) {
  const sess = sessaoDe(req); if (!sess || sess.tipo !== 'aluno') return json(res, 401, { erro: 'SESSAO' });
  const mat = sess.usuario;
  if (!db.alunos[mat]) return json(res, 404, { erro: 'Aluno não encontrado.' });
  // apaga o cadastro
  delete db.alunos[mat];
  // remove entregas e liberações do aluno em todas as peças
  for (const pid of Object.keys(db.entregas || {})) { if (db.entregas[pid] && db.entregas[pid][mat]) delete db.entregas[pid][mat]; }
  for (const pid of Object.keys(db.pecas || {})) { const p = db.pecas[pid]; if (p && p.liberados && p.liberados[mat]) delete p.liberados[mat]; }
  salvarDb();
  // invalida todas as sessões desse aluno
  for (const [t, s] of Array.from(sessoes)) { if (s.tipo === 'aluno' && s.usuario === mat) encerrarSessao(t); }
  json(res, 200, { ok: true });
}
// Professor: ver o texto de uma entrega
async function entregaGet(req, res, id, mat) {
  const sess = sessaoDe(req); if (!sess) return json(res, 401, { erro: 'SESSAO' }); if (sess.tipo !== 'professor') return json(res, 403, { erro: 'Acesso restrito.' });
  const e = (db.entregas[id] || {})[mat]; if (!e) return json(res, 404, { erro: 'Entrega não encontrada.' });
  const p = db.pecas[id] || {};
  json(res, 200, { ok: true, peca: { num: p.num, nomePeca: p.nomePeca, caso: p.caso, gab: p.gab }, aluno: { matricula: mat, nome: (db.alunos[mat] && db.alunos[mat].nome) || '' }, texto: e.texto, relatorio: e.relatorio || '', nota: (e.nota != null ? e.nota : ''), validado: !!e.validado });
}
// Professor: pedir à IA um relatório com nota para uma entrega
async function entregaCorrigirIA(req, res) {
  const sess = sessaoDe(req); if (!sess) return json(res, 401, { erro: 'SESSAO' }); if (sess.tipo !== 'professor') return json(res, 403, { erro: 'Acesso restrito.' });
  if (limitado((req.headers['x-forwarded-for']||'').split(',')[0])) return json(res, 429, { erro: 'Aguarde um minuto.' });
  let d; try { d = await lerJson(req, 5000); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  const p = db.pecas[String(d.id || '')]; const e = p && (db.entregas[p.id] || {})[String(d.matricula || '')];
  if (!e) return json(res, 404, { erro: 'Entrega não encontrada.' });
  if (!process.env.ANTHROPIC_API_KEY) return json(res, 500, { erro: 'Servidor sem chave configurada.' });
  const usuario = 'PEÇA ESPERADA: ' + p.nomePeca + ' (' + p.disc + ')\n\nCASO DADO AO ALUNO:\n' + (p.caso||'') + '\n\nGABARITO DO PROFESSOR:\n' + (p.gab||'') + '\n\nPEÇA DO ALUNO (corrija-a e dê a nota):\n' + String(e.texto||'').slice(0,60000);
  const r = await iaTexto(SISTEMA, usuario, 6000, true);
  if (!r.ok) return erroIA(res, r);
  const mN = r.texto.match(/NOTA SUGERIDA:\s*([0-9]+(?:[\.,][0-9]+)?)/i);
  e.relatorio = r.texto; e.notaSugerida = mN ? mN[1].replace(',', '.') : ''; salvarDb();
  json(res, 200, { ok: true, relatorio: r.texto, notaSugerida: e.notaSugerida });
}
// Professor: salvar (editar) relatório+nota e VALIDAR (envia ao aluno por e-mail)
async function entregaValidar(req, res) {
  const sess = sessaoDe(req); if (!sess) return json(res, 401, { erro: 'SESSAO' }); if (sess.tipo !== 'professor') return json(res, 403, { erro: 'Acesso restrito.' });
  let d; try { d = await lerJson(req, 300000); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  const p = db.pecas[String(d.id || '')]; const e = p && (db.entregas[p.id] || {})[String(d.matricula || '')];
  if (!e) return json(res, 404, { erro: 'Entrega não encontrada.' });
  e.relatorio = String(d.relatorio || '').trim();
  const notaNum = parseFloat(String(d.nota).replace(',', '.'));
  if (isNaN(notaNum) || notaNum < 0 || notaNum > 10) return json(res, 400, { erro: 'Nota inválida (0 a 10).' });
  e.nota = Math.round(notaNum * 100) / 100;
  if (d.validar) {
    e.validado = true; e.validadoEm = Date.now(); e.validadoPor = sess.usuario;
    const a = db.alunos[String(d.matricula)];
    if (a && a.email && a.emailVerificado) {
      const html = '<p>Olá, ' + escHtml(a.nome || '') + '!</p><p>Sua <b>Peça ' + p.num + ' — ' + escHtml(p.nomePeca) + '</b> foi corrigida.</p><p><b>Nota: ' + e.nota.toString().replace('.', ',') + '/10</b></p><hr><div style="white-space:pre-wrap;font-family:Georgia,serif">' + escHtml(e.relatorio) + '</div>';
      enviarEmail(a.email, 'Correção da Peça ' + p.num + ' — Nota ' + e.nota.toString().replace('.', ','), html);
    }
  }
  salvarDb();
  json(res, 200, { ok: true, validado: !!e.validado });
}
// Professor: renovar prazo de uma peça
async function pecaRenovarPrazo(req, res) {
  const sess = sessaoDe(req); if (!sess) return json(res, 401, { erro: 'SESSAO' }); if (sess.tipo !== 'professor') return json(res, 403, { erro: 'Acesso restrito.' });
  let d; try { d = await lerJson(req, 5000); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  const p = db.pecas[String(d.id || '')]; if (!p) return json(res, 404, { erro: 'Peça não encontrada.' });
  p.prazo = String(d.prazo || '').trim(); salvarDb(); json(res, 200, { ok: true, prazo: p.prazo });
}
// Professor: liberar entrega fora do prazo (geral para a peça, ou para um aluno)
async function pecaLiberarPrazo(req, res) {
  const sess = sessaoDe(req); if (!sess) return json(res, 401, { erro: 'SESSAO' }); if (sess.tipo !== 'professor') return json(res, 403, { erro: 'Acesso restrito.' });
  let d; try { d = await lerJson(req, 5000); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  const p = db.pecas[String(d.id || '')]; if (!p) return json(res, 404, { erro: 'Peça não encontrada.' });
  if (d.matricula) { p.liberados = p.liberados || {}; if (d.liberar === false) delete p.liberados[String(d.matricula)]; else p.liberados[String(d.matricula)] = true; }
  else { p.foraDoPrazoGeral = d.liberar !== false; }
  salvarDb(); json(res, 200, { ok: true, foraDoPrazoGeral: !!p.foraDoPrazoGeral, liberados: p.liberados || {} });
}

// Professor: planilha CSV de notas
async function notasPlanilha(req, res) {
  const sess = sessaoDe(req); if (!sess) { res.writeHead(401); return res.end('SESSAO'); } if (sess.tipo !== 'professor') { res.writeHead(403); return res.end('restrito'); }
  const pecas = Object.values(db.pecas).sort((a, b) => a.num - b.num);
  const linhas = [];
  const cab = ['Aluno', 'Matrícula'].concat(pecas.map(p => 'Peça ' + p.num + ' (' + p.nomePeca.replace(/;/g, ' ') + ')'));
  linhas.push(cab.join(';'));
  const mats = Object.keys(db.alunos).sort((m1, m2) => (db.alunos[m1].nome || '').localeCompare(db.alunos[m2].nome || ''));
  for (const mat of mats) {
    const a = db.alunos[mat];
    const row = [(a.nome || '').replace(/;/g, ' '), mat];
    for (const p of pecas) { const e = (db.entregas[p.id] || {})[mat]; row.push(e && e.nota != null ? String(e.nota).replace('.', ',') : ''); }
    linhas.push(row.join(';'));
  }
  const csv = '﻿' + linhas.join('\r\n');
  res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="notas.csv"' });
  res.end(csv);
}
// Professor: ZERAR todo o sistema (mantém contas de professores)
async function zerarSistema(req, res) {
  const sess = sessaoDe(req); if (!sess) return json(res, 401, { erro: 'SESSAO' }); if (sess.tipo !== 'professor') return json(res, 403, { erro: 'Acesso restrito.' });
  let d; try { d = await lerJson(req, 5000); } catch { return json(res, 400, { erro: 'Requisição inválida.' }); }
  if (d.confirmacao !== 'ZERAR') return json(res, 400, { erro: 'Confirmação inválida.' });
  db.alunos = {}; db.pecas = {}; db.entregas = {}; db.proximoNum = 1; salvarDb();
  json(res, 200, { ok: true });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/login') return apiLogin(req, res);
  if (req.method === 'POST' && req.url === '/api/trocar-senha') return apiTrocarSenha(req, res);
  if (req.method === 'POST' && req.url === '/api/admin') return apiAdmin(req, res);
  if (req.method === 'POST' && req.url === '/api/extrair-pdf') return extrairPdf(req, res);
  if (req.method === 'POST' && req.url === '/api/gabarito') return gabaritoIA(req, res);
  if (req.method === 'POST' && req.url === '/api/corrigir') return corrigir(req, res);
  if (req.method === 'POST' && req.url === '/api/email-professor') return apiEmailProfessor(req, res);
  if (req.method === 'GET' && req.url === '/api/professores') return professoresListar(req, res);
  if (req.method === 'POST' && req.url === '/api/professores/salvar') return professorSalvar(req, res);
  if (req.method === 'POST' && req.url === '/api/professores/excluir') return professorExcluir(req, res);
  if (req.method === 'POST' && req.url === '/api/professores/reset') return professorReset(req, res);
  if (req.method === 'POST' && req.url === '/api/verificar-email') return apiVerificarEmail(req, res);
  if (req.method === 'POST' && req.url === '/api/reenviar-codigo') return apiReenviarCodigo(req, res);
  if (req.method === 'POST' && req.url === '/api/peca/gerar-ia') return pecaGerarIA(req, res);
  if (req.method === 'POST' && req.url === '/api/peca/gerar-gabarito') return pecaGerarGabarito(req, res);
  if (req.method === 'POST' && req.url === '/api/peca/extrair-pdf') return pecaExtrairPdf(req, res);
  if (req.method === 'POST' && req.url === '/api/peca/salvar') return pecaSalvar(req, res);
  if (req.method === 'POST' && req.url === '/api/peca/excluir') return pecaExcluir(req, res);
  if (req.method === 'GET' && req.url === '/api/pecas') return pecasListar(req, res);
  if (req.method === 'GET' && req.url.startsWith('/api/peca/get?')) { const id = new URLSearchParams(req.url.split('?')[1]).get('id'); return pecaGet(req, res, id); }
  if (req.method === 'GET' && req.url === '/api/pecas-aluno') return pecasAluno(req, res);
  if (req.method === 'POST' && req.url === '/api/entregar') return entregar(req, res);
  if (req.method === 'POST' && req.url === '/api/descadastrar') return descadastrarAluno(req, res);
  if (req.method === 'GET' && req.url.startsWith('/api/entrega?')) { const q = new URLSearchParams(req.url.split('?')[1]); return entregaGet(req, res, q.get('id'), q.get('matricula')); }
  if (req.method === 'POST' && req.url === '/api/entrega/corrigir') return entregaCorrigirIA(req, res);
  if (req.method === 'POST' && req.url === '/api/entrega/validar') return entregaValidar(req, res);
  if (req.method === 'POST' && req.url === '/api/peca/renovar-prazo') return pecaRenovarPrazo(req, res);
  if (req.method === 'POST' && req.url === '/api/peca/liberar-prazo') return pecaLiberarPrazo(req, res);
  if (req.method === 'GET' && req.url === '/api/notas.csv') return notasPlanilha(req, res);
  if (req.method === 'POST' && req.url === '/api/zerar') return zerarSistema(req, res);
  if (req.method === 'POST' && req.url === '/api/gerar-caso') return gerarCaso(req, res);
  // página única: qualquer GET serve o index.html
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  fs.readFile(path.join(PUBLIC, 'index.html'), (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Não encontrado'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, must-revalidate' });
    res.end(buf);
  });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Laboratório de Peças no ar, porta ' + PORT));