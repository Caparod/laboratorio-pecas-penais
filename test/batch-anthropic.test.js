'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { casoTeste, gabaritoTeste } = require('./fixture-peca');

const appDir = path.resolve(__dirname, '..');
const fonteServidor = fs.readFileSync(path.join(appDir, 'server.js'), 'utf8');
const fonteValidacao = fs.readFileSync(path.join(__dirname, 'ia-validacao.test.js'), 'utf8');
const correcaoValida = (fonteValidacao.match(/const correcao = `([\s\S]*?)`;/) || [])[1];
assert.ok(correcaoValida && correcaoValida.includes('NOTA SUGERIDA: 4,00/5'));
assert.match(fonteServidor, /job\.status = 'criacao-incerta'/, 'criação ambígua precisa de estado próprio');
assert.match(fonteServidor, /respostaCriacao\.status >= 400 && respostaCriacao\.status < 500/, 'somente rejeição 4xx explícita pode liberar o fallback');

function hashSenha(senha, salt) { return salt + ':' + crypto.scryptSync(senha, salt, 32).toString('hex'); }
function esperar(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function fotografia(p) { return { versao: 1, rodada: 1, nomePeca: p.nomePeca, disc: p.disc, turmaId: p.turmaId, caso: p.caso, gab: p.gab, prazo: p.prazo, publicada: true }; }
function criarBanco(dataDir, quantidade, refAusente) {
  const professor = { login: 'admin-batch', senha: hashSenha('Admin-Batch-2026', 'sal-prof'), mudouSenha: true, nome: 'Administrador Batch', papel: 'Administrador', aceitePrivacidadeEm: Date.now(), versaoPrivacidade: '2026-08-batch-v1' };
  const p = { id: 'p1', num: 1, rodada: 1, nomePeca: 'Manifestação processual', disc: 'Turma batch', turmaId: 't1', caso: casoTeste(), gab: gabaritoTeste('Manifestação processual'), prazo: '2099-12-31T23:59', criadaEm: Date.now(), publicada: true, autor: 'admin-batch', versao: 1, historico: [] };
  const alunos = {}, entregas = {};
  for (let i = 1; i <= quantidade; i++) {
    const mat = '992000' + i;
    alunos[mat] = { nome: 'Aluno ' + i, senha: hashSenha('Aluno-Batch-2026', 'sal-' + i), mudouSenha: true, email: `aluno${i}@example.test`, whatsapp: '+5561999999999', emailVerificado: true, cadastroCompletoEm: Date.now(), aceitePrivacidadeEm: Date.now(), versaoPrivacidade: '2026-08-batch-v1', turmaId: 't1', turmaIds: ['t1'], usos: {} };
    entregas[mat] = { nome: 'Aluno ' + i, texto: 'TEXTO-' + (i === 1 ? 'UM' : i === 2 ? 'DOIS' : i === 3 ? 'TRES' : 'QUATRO') + ' — resposta acadêmica suficientemente extensa e individualizada para a correção.', enviadoEm: Date.now() + i, turmaId: 't1', versaoPeca: 1, snapshotPeca: fotografia(p) };
  }
  if (refAusente && entregas['9920003']) { delete entregas['9920003'].snapshotPeca; entregas['9920003'].snapshotPecaRef = 'a'.repeat(64); }
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ turmaAtiva: 'Turma batch', alunos, professor, professores: { 'admin-batch': professor }, turmas: { t1: { id: 't1', nome: 'Turma batch', professores: ['admin-batch'], criadaEm: Date.now() } }, proximaTurma: 2, pecas: { p1: p }, proximoNum: 2, entregas: { p1: entregas }, sessoes: {}, gastos: {} }), 'utf8');
}
function tornarAltoRisco(dataDir, matriculas) {
  const arquivo = path.join(dataDir, 'db.json'), banco = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  for (const matricula of matriculas) banco.entregas.p1[matricula].texto += ' Confira o precedente oficial em https://jurisprudencia.stf.jus.br/ para esta tese.';
  fs.writeFileSync(arquivo, JSON.stringify(banco), 'utf8');
}

let modo = 'batch', resultadoEspecial = '', batchTerminou = false, requestsCriados = [], deletes = 0, continuacoes = 0, continuacoesMaxTokens = 0, postsBatch = 0, consultasBatch = 0, chamadasSyncIniciais = 0, corposSyncIniciais = [];
const appsAtivos = new Set();
const anthropic = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://mock');
  let body = ''; for await (const parte of req) body += parte;
  if (req.method === 'POST' && url.pathname === '/v1/messages/batches') {
    postsBatch++;
    requestsCriados = JSON.parse(body).requests;
    if (modo === 'rejeitar') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'rejeição explícita de teste' } })); }
    if (modo === 'incerto') { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'estado de aceitação incerto' } })); }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (modo === 'json-invalido') return res.end('{');
    return res.end(JSON.stringify({ id: 'msgbatch_teste', type: 'message_batch', processing_status: 'in_progress', request_counts: { processing: requestsCriados.length, succeeded: 0, errored: 0, expired: 0, canceled: 0 }, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString() }));
  }
  if (req.method === 'GET' && url.pathname === '/v1/messages/batches/msgbatch_teste') {
    consultasBatch++;
    const total = requestsCriados.length;
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ id: 'msgbatch_teste', type: 'message_batch', processing_status: batchTerminou ? 'ended' : 'in_progress', request_counts: batchTerminou ? { processing: 0, succeeded: total, errored: 0, expired: 0, canceled: 0 } : { processing: total, succeeded: 0, errored: 0, expired: 0, canceled: 0 } }));
  }
  if (req.method === 'GET' && url.pathname === '/v1/messages/batches/msgbatch_teste/results') {
    if (resultadoEspecial === 'resultados-404') { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error' })); }
    const linhas = requestsCriados.slice().reverse().map((item, indice) => {
      const pausa = JSON.stringify(item.params).includes('TEXTO-UM');
      const maximo = JSON.stringify(item.params).includes('TEXTO-QUATRO');
      if (resultadoEspecial === 'cancelado') return JSON.stringify({ custom_id: item.custom_id, result: { type: 'canceled' } });
      const message = { id: 'msg_' + indice, type: 'message', role: 'assistant', model: 'claude-sonnet-5', stop_reason: pausa ? 'pause_turn' : maximo ? 'max_tokens' : 'end_turn', content: pausa ? [] : maximo ? [{ type: 'text', text: 'Trecho parcial da correção.' }] : [{ type: 'text', text: correcaoValida }] };
      if (resultadoEspecial !== 'sem-usage') message.usage = { input_tokens: 1000000, output_tokens: 0, cache_creation_input_tokens: 100000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 100000 }, cache_read_input_tokens: 0 };
      return JSON.stringify({ custom_id: item.custom_id, result: { type: 'succeeded', message } });
    });
    res.writeHead(200, { 'content-type': 'application/x-ndjson' }); return res.end(linhas.join('\n') + '\n');
  }
  if (req.method === 'DELETE' && url.pathname === '/v1/messages/batches/msgbatch_teste') { deletes++; res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ id: 'msgbatch_teste', type: 'message_batch_deleted' })); }
  if (req.method === 'POST' && url.pathname === '/v1/messages') {
    const recebido = JSON.parse(body);
    const continuacao = (recebido.messages || []).some(m => m.role === 'assistant');
    if (continuacao) continuacoes++;
    else { chamadasSyncIniciais++; corposSyncIniciais.push(recebido); }
    if ((recebido.messages || []).some(m => m.role === 'user' && String(m.content || '').includes('Continue exatamente'))) continuacoesMaxTokens++;
    res.writeHead(200, { 'content-type': 'application/json' });
    const temBusca = (recebido.tools || []).some(t => t && (t.name === 'web_search' || /^web_search_/.test(String(t.type || ''))));
    return res.end(JSON.stringify({ id: 'msg_sync', type: 'message', role: 'assistant', model: recebido.model || 'claude-sonnet-5', stop_reason: 'end_turn', content: [{ type: 'text', text: correcaoValida }], usage: continuacao ? { input_tokens: 0, output_tokens: 0 } : { input_tokens: 1000000, output_tokens: 0, server_tool_use: { web_search_requests: temBusca ? 1 : 0 } } }));
  }
  res.writeHead(404); res.end();
});

async function iniciarApp(dataDir, porta, envExtra) {
  let log = '';
  const app = spawn(process.execPath, ['server.js'], { cwd: appDir, env: Object.assign({}, process.env, { DATA_DIR: dataDir, PORT: String(porta), PROF_LOGIN: 'admin-batch', PROF_SENHA: 'Admin-Batch-2026', CRIAR_CONTAS_DEMO: 'false', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', ANTHROPIC_API_KEY: 'chave-teste', ANTHROPIC_API_URL: `http://127.0.0.1:${anthropic.address().port}/v1/messages`, ANTHROPIC_BATCHES_API_URL: `http://127.0.0.1:${anthropic.address().port}/v1/messages/batches`, ANTHROPIC_BATCHES_ATIVO: 'true', ORCAMENTO_IA_MENSAL_USD: '100', ORCAMENTO_IA_SEM_TETO: 'false' }, envExtra || {}), stdio: ['ignore', 'pipe', 'pipe'] });
  appsAtivos.add(app);
  app.stdout.on('data', b => { log += b; }); app.stderr.on('data', b => { log += b; });
  const base = `http://127.0.0.1:${porta}`;
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base)).ok) return { app, base, log: () => log }; } catch {} await esperar(100); }
  app.kill(); throw new Error('Servidor não iniciou.\n' + log);
}
async function parar(app) { if (!app) return; if (app.exitCode == null) { app.kill(); await new Promise(resolve => app.once('exit', resolve)); } appsAtivos.delete(app); }
async function post(base, rota, cookie, body) { const r = await fetch(base + rota, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json(), cookie: String(r.headers.get('set-cookie') || '').split(';')[0] }; }
async function loginComo(base, usuario, senha) { const r = await post(base, '/api/login', '', { usuario, senha }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.cookie; }
async function login(base) { return loginComo(base, 'admin-batch', 'Admin-Batch-2026'); }
async function aguardarJob(base, cookie, id, estados, limite) {
  let ultimo;
  for (let i = 0; i < (limite || 120); i++) { const r = await fetch(base + '/api/entrega/corrigir-todas-status?job=' + encodeURIComponent(id), { headers: { cookie } }); ultimo = await r.json(); if (ultimo.job && estados.includes(ultimo.job.status)) return ultimo.job; await esperar(150); }
  throw new Error('Job não atingiu ' + estados.join('/') + ': ' + JSON.stringify(ultimo));
}
async function aguardarItem(base, cookie, id, status, limite) {
  let ultimo;
  for (let i = 0; i < (limite || 120); i++) {
    const r = await fetch(base + '/api/entrega/corrigir-todas-status?job=' + encodeURIComponent(id), { headers: { cookie } });
    ultimo = await r.json();
    if (ultimo.job && (ultimo.job.itens || []).some(item => item.status === status)) return ultimo.job;
    await esperar(150);
  }
  throw new Error('Item não atingiu ' + status + ': ' + JSON.stringify(ultimo));
}

async function executar() {
  await new Promise((resolve, reject) => { anthropic.once('error', reject); anthropic.listen(0, '127.0.0.1', resolve); });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-batch-')); criarBanco(dataDir, 4, true);
  const porta = 41700 + Math.floor(Math.random() * 300);
  let servidor = await iniciarApp(dataDir, porta); let cookie = await login(servidor.base);
  const inicio = await post(servidor.base, '/api/entrega/corrigir-todas', cookie, { id: 'p1' });
  assert.equal(inicio.status, 202, JSON.stringify(inicio.body)); assert.equal(inicio.body.assincrono, true); assert.equal(requestsCriados.length, 3, 'referência ausente deve bloquear só o item defeituoso');
  const jobId = inicio.body.jobId;
  let disco = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.equal(disco.lotesAnthropic[jobId].providerBatchId, 'msgbatch_teste'); assert.ok(disco.lotesAnthropic[jobId].reservaOrcamentoUSD > 0, 'reserva deve sobreviver ao reinício');
  await parar(servidor.app);
  disco = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8')); disco.entregas.p1['9920002'].texto += ' ALTERADO APÓS O ENVIO AO LOTE'; fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(disco), 'utf8');
  batchTerminou = true; servidor = await iniciarApp(dataDir, porta); cookie = await login(servidor.base);
  const concluido = await aguardarJob(servidor.base, cookie, jobId, ['concluido'], 180);
  assert.equal(concluido.rascunhosGerados, 2); assert.equal(concluido.falhas, 1, 'snapshot ausente permanece como falha isolada'); assert.ok(continuacoes >= 2, 'pause_turn e max_tokens devem ser continuados antes da validação'); assert.ok(continuacoesMaxTokens >= 1, 'max_tokens deve pedir continuação explícita'); assert.ok(deletes >= 1, 'batch remoto deve ser apagado após a ingestão');
  disco = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.ok(disco.entregas.p1['9920001'].relatorio); assert.equal(disco.entregas.p1['9920001'].validado, false); assert.equal(disco.entregas.p1['9920001'].revisaoHumana, undefined); assert.equal(disco.entregas.p1['9920001'].emailCorrecaoEnviado, undefined);
  assert.equal(disco.entregas.p1['9920002'].relatorio, undefined, 'fingerprint divergente nunca pode ser aplicado'); assert.equal(disco.entregas.p1['9920003'].relatorio, undefined, 'referência ausente nunca pode ser aplicada');
  assert.ok(disco.entregas.p1['9920004'].relatorio, 'max_tokens continuado deve produzir rascunho'); assert.equal(disco.entregas.p1['9920004'].validado, false);
  const mes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date()); const gasto = disco.gastos[mes]['prof:admin-batch'];
  assert.equal(gasto.chamadas, 3, 'cada resultado deve ser registrado uma única vez'); assert.equal(gasto.usd, 3.6, 'batch aplica fator 0,5 e cache de uma hora aplica multiplicador 2x'); assert.equal(gasto.cacheGravado1h, 300000);
  await aguardarJob(servidor.base, cookie, jobId, ['concluido'], 5); const depois = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8')).gastos[mes]['prof:admin-batch']; assert.equal(depois.chamadas, 3, 'polling repetido deve ser idempotente'); await parar(servidor.app);

  modo = 'rejeitar'; batchTerminou = false; requestsCriados = [];
  const dataFallback = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-batch-fallback-')); criarBanco(dataFallback, 2, false); tornarAltoRisco(dataFallback, ['9920002']);
  const syncAntesFallback = chamadasSyncIniciais;
  servidor = await iniciarApp(dataFallback, porta + 301); cookie = await login(servidor.base);
  const fallback = await post(servidor.base, '/api/entrega/corrigir-todas', cookie, { id: 'p1' });
  assert.equal(fallback.status, 202, JSON.stringify(fallback.body)); assert.equal(fallback.body.fallbackSequencial, true, '4xx explícito deve cair no fluxo sequencial');
  assert.equal(requestsCriados.length, 1, 'o POST rejeitado ainda deve conter só a faixa Sonnet sem tools'); assert.equal(requestsCriados[0].params.tools, undefined);
  await aguardarJob(servidor.base, cookie, fallback.body.jobId, ['concluido'], 180);
  assert.equal(chamadasSyncIniciais, syncAntesFallback + 2, '4xx explícito move a faixa batch e a faixa cara para o sequencial uma única vez');
  const bancoFallback = JSON.parse(fs.readFileSync(path.join(dataFallback, 'db.json'), 'utf8')); assert.ok(bancoFallback.entregas.p1['9920001'].relatorio); assert.ok(bancoFallback.entregas.p1['9920002'].relatorio); assert.equal(bancoFallback.entregas.p1['9920001'].validado, false); await parar(servidor.app);

  modo = 'incerto';
  const dataIncerto = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-batch-incerto-')); criarBanco(dataIncerto, 2, false); tornarAltoRisco(dataIncerto, ['9920002']);
  const syncAntesIncerto = chamadasSyncIniciais;
  servidor = await iniciarApp(dataIncerto, porta + 602); cookie = await login(servidor.base);
  const incerto = await post(servidor.base, '/api/entrega/corrigir-todas', cookie, { id: 'p1' });
  assert.equal(incerto.status, 202); assert.equal(incerto.body.criacaoIncerta, true); assert.equal(incerto.body.fallbackSequencial, false, 'HTTP 5xx não pode duplicar o lote no fluxo síncrono');
  assert.equal(requestsCriados.length, 1, 'mesmo no POST incerto, apenas o item Sonnet econômico é enviado'); assert.equal(requestsCriados[0].params.model, 'claude-sonnet-5'); assert.equal(requestsCriados[0].params.tools, undefined); await esperar(300); assert.equal(chamadasSyncIniciais, syncAntesIncerto, '5xx ambíguo não inicia nem a fase sequencial antes de reconciliar o batch');
  const bancoIncerto = JSON.parse(fs.readFileSync(path.join(dataIncerto, 'db.json'), 'utf8'));
  const jobIncerto = bancoIncerto.lotesAnthropic[incerto.body.jobId]; assert.equal(jobIncerto.status, 'criacao-incerta'); assert.ok(jobIncerto.reservaOrcamentoUSD > 0); assert.equal(jobIncerto.requerReconciliacaoManual, true); assert.equal(jobIncerto.reservaExpiraEm, undefined, 'reserva incerta não pode expirar automaticamente'); assert.equal(bancoIncerto.entregas.p1['9920001'].relatorio, undefined);
  const exclusaoBloqueada = await post(servidor.base, '/api/peca/excluir', cookie, { id: 'p1' }); assert.equal(exclusaoBloqueada.status, 409, 'peça com criação incerta permanece travada até reconciliação');
  const reconciliado = await post(servidor.base, '/api/lotes-anthropic/reconciliar', cookie, { job: incerto.body.jobId, confirmacao: 'LIBERAR RESERVA', resultadoConsole: 'nao-aceito', motivo: 'Conferência de teste confirmou que o lote não foi aceito no Console.' }); assert.equal(reconciliado.status, 200, JSON.stringify(reconciliado.body)); assert.equal(reconciliado.body.ajusteRegistradoUSD, 0);
  const bancoReconciliado = JSON.parse(fs.readFileSync(path.join(dataIncerto, 'db.json'), 'utf8')); assert.equal(bancoReconciliado.lotesAnthropic[incerto.body.jobId].status, 'pendencia-batch-reconciliada'); assert.equal(bancoReconciliado.lotesAnthropic[incerto.body.jobId].reservaOrcamentoUSD, 0); await parar(servidor.app);

  modo = 'json-invalido'; resultadoEspecial = ''; batchTerminou = false; requestsCriados = [];
  const dataJsonInvalido = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-batch-json-invalido-')); criarBanco(dataJsonInvalido, 1, false);
  servidor = await iniciarApp(dataJsonInvalido, porta + 903); cookie = await login(servidor.base);
  const jsonInvalido = await post(servidor.base, '/api/entrega/corrigir-todas', cookie, { id: 'p1' });
  assert.equal(jsonInvalido.status, 202); assert.equal(jsonInvalido.body.criacaoIncerta, true, '2xx ilegível pode ter sido aceito e não deve cair no fallback');
  const bancoJsonInvalido = JSON.parse(fs.readFileSync(path.join(dataJsonInvalido, 'db.json'), 'utf8')); assert.equal(bancoJsonInvalido.lotesAnthropic[jsonInvalido.body.jobId].status, 'criacao-incerta'); assert.ok(bancoJsonInvalido.lotesAnthropic[jsonInvalido.body.jobId].reservaOrcamentoUSD > 0); await parar(servidor.app);

  modo = 'batch'; resultadoEspecial = ''; batchTerminou = false; requestsCriados = [];
  const dataGabarito = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-batch-gabarito-')); criarBanco(dataGabarito, 1, false);
  const bancoGabaritoInicial = JSON.parse(fs.readFileSync(path.join(dataGabarito, 'db.json'), 'utf8')); bancoGabaritoInicial.professores['professor-lote'] = { login: 'professor-lote', senha: hashSenha('Professor-Lote-2026', 'sal-professor-lote'), mudouSenha: true, nome: 'Professor do Lote', papel: 'Professor(a)', aceitePrivacidadeEm: Date.now(), versaoPrivacidade: '2026-08-batch-v1' }; bancoGabaritoInicial.turmas.t1.professores.push('professor-lote'); fs.writeFileSync(path.join(dataGabarito, 'db.json'), JSON.stringify(bancoGabaritoInicial), 'utf8');
  servidor = await iniciarApp(dataGabarito, porta + 1204); cookie = await loginComo(servidor.base, 'professor-lote', 'Professor-Lote-2026');
  const loteGabarito = await post(servidor.base, '/api/entrega/corrigir-todas', cookie, { id: 'p1' }); assert.equal(loteGabarito.status, 202); await parar(servidor.app);
  const bancoGabaritoAntes = JSON.parse(fs.readFileSync(path.join(dataGabarito, 'db.json'), 'utf8')); bancoGabaritoAntes.pecas.p1.gab += '\nObservação atualizada pelo professor durante o processamento.'; bancoGabaritoAntes.pecas.p1.versao = 2; fs.writeFileSync(path.join(dataGabarito, 'db.json'), JSON.stringify(bancoGabaritoAntes), 'utf8');
  batchTerminou = true; servidor = await iniciarApp(dataGabarito, porta + 1204);
  cookie = await login(servidor.base); const statusPorPeca = await fetch(servidor.base + '/api/entrega/corrigir-todas-status?peca=p1', { headers: { cookie } }); const corpoPorPeca = await statusPorPeca.json(); assert.equal(statusPorPeca.status, 200); assert.equal(corpoPorPeca.job.id, loteGabarito.body.jobId, 'admin deve recuperar pela peça um lote iniciado por outro professor');
  const gabaritoConcluido = await aguardarJob(servidor.base, cookie, loteGabarito.body.jobId, ['concluido'], 180); assert.equal(gabaritoConcluido.itens[0].status, 'ignorado-contexto-alterado');
  const bancoGabaritoDepois = JSON.parse(fs.readFileSync(path.join(dataGabarito, 'db.json'), 'utf8')); assert.equal(bancoGabaritoDepois.entregas.p1['9920001'].relatorio, undefined, 'mudança de gabarito/versão invalida o resultado do lote'); await parar(servidor.app);

  modo = 'batch'; resultadoEspecial = ''; batchTerminou = true; requestsCriados = [];
  const dataHibrido = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-batch-hibrido-')); criarBanco(dataHibrido, 2, false); tornarAltoRisco(dataHibrido, ['9920002']);
  const postsAntesHibrido = postsBatch, syncAntesHibrido = chamadasSyncIniciais;
  servidor = await iniciarApp(dataHibrido, porta + 2107); cookie = await login(servidor.base);
  const loteHibrido = await post(servidor.base, '/api/entrega/corrigir-todas', cookie, { id: 'p1' });
  assert.equal(loteHibrido.status, 202); assert.equal(loteHibrido.body.loteHibrido, true); assert.equal(postsBatch, postsAntesHibrido + 1); assert.equal(requestsCriados.length, 1, 'somente o item comum entra no Message Batch'); assert.equal(requestsCriados[0].params.model, 'claude-sonnet-5'); assert.equal(requestsCriados[0].params.tools, undefined, 'batch econômico não envia web_search nem tool local');
  const hibridoConcluido = await aguardarJob(servidor.base, cookie, loteHibrido.body.jobId, ['concluido'], 240);
  assert.equal(chamadasSyncIniciais, syncAntesHibrido + 1, 'alto risco deve ter exatamente uma chamada síncrona'); assert.equal(hibridoConcluido.rascunhosGerados, 2);
  const corpoCaro = corposSyncIniciais.at(-1); assert.equal(corpoCaro.model, 'claude-opus-4-8'); assert.ok((corpoCaro.tools || []).some(t => t.name === 'web_search'), 'alto risco preserva busca oficial fora do batch');
  let bancoHibrido = JSON.parse(fs.readFileSync(path.join(dataHibrido, 'db.json'), 'utf8')); assert.ok(bancoHibrido.entregas.p1['9920001'].relatorio); assert.ok(bancoHibrido.entregas.p1['9920002'].relatorio); assert.equal(bancoHibrido.entregas.p1['9920002'].validado, false); assert.equal(bancoHibrido.entregas.p1['9920002'].emailCorrecaoTentadoEm, undefined);
  const gastoHibrido = bancoHibrido.gastos[mes]['prof:admin-batch']; assert.equal(gastoHibrido.porOperacao['correcao-padrao-batch'].usd, 1.2, 'tokens do batch usam fator 0,5'); assert.equal(gastoHibrido.porOperacao['correcao-alto-risco'].usd, 5.01, 'fase síncrona usa preço integral e busca sem desconto');
  const syncAposHibrido = chamadasSyncIniciais, postsAposHibrido = postsBatch; await parar(servidor.app);
  servidor = await iniciarApp(dataHibrido, porta + 2107); cookie = await login(servidor.base); await aguardarJob(servidor.base, cookie, loteHibrido.body.jobId, ['concluido'], 10); await esperar(250); assert.equal(chamadasSyncIniciais, syncAposHibrido, 'restart não duplica item sequencial já concluído'); assert.equal(postsBatch, postsAposHibrido, 'restart não recria batch concluído'); await parar(servidor.app);

  batchTerminou = false; requestsCriados = [];
  const dataFingerprintCaro = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-batch-fingerprint-caro-')); criarBanco(dataFingerprintCaro, 2, false); tornarAltoRisco(dataFingerprintCaro, ['9920002']);
  servidor = await iniciarApp(dataFingerprintCaro, porta + 2408); cookie = await login(servidor.base); const loteFingerprintCaro = await post(servidor.base, '/api/entrega/corrigir-todas', cookie, { id: 'p1' }); const postsFingerprint = postsBatch; await parar(servidor.app);
  const arquivoFingerprint = path.join(dataFingerprintCaro, 'db.json'), bancoFingerprint = JSON.parse(fs.readFileSync(arquivoFingerprint, 'utf8')); bancoFingerprint.entregas.p1['9920002'].texto += ' ALTERAÇÃO DURANTE O BATCH'; fs.writeFileSync(arquivoFingerprint, JSON.stringify(bancoFingerprint), 'utf8');
  const syncAntesFingerprint = chamadasSyncIniciais; batchTerminou = true; servidor = await iniciarApp(dataFingerprintCaro, porta + 2408); cookie = await login(servidor.base); const fingerprintConcluido = await aguardarJob(servidor.base, cookie, loteFingerprintCaro.body.jobId, ['concluido'], 240); assert.equal(postsBatch, postsFingerprint); assert.equal(chamadasSyncIniciais, syncAntesFingerprint, 'fingerprint divergente bloqueia a chamada cara'); assert.equal(fingerprintConcluido.itens.find(i => i.matricula === '9920002').status, 'ignorado-contexto-alterado'); const bancoFingerprintDepois = JSON.parse(fs.readFileSync(arquivoFingerprint, 'utf8')); assert.ok(bancoFingerprintDepois.entregas.p1['9920001'].relatorio); assert.equal(bancoFingerprintDepois.entregas.p1['9920002'].relatorio, undefined); await parar(servidor.app);

  const dataSoCaro = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-batch-so-caro-')); criarBanco(dataSoCaro, 1, false); tornarAltoRisco(dataSoCaro, ['9920001']);
  const postsAntesSoCaro = postsBatch, syncAntesSoCaro = chamadasSyncIniciais;
  servidor = await iniciarApp(dataSoCaro, porta + 2709); cookie = await login(servidor.base); const loteSoCaro = await post(servidor.base, '/api/entrega/corrigir-todas', cookie, { id: 'p1' }); assert.equal(loteSoCaro.status, 202); assert.equal(loteSoCaro.body.assincrono, false); assert.equal(loteSoCaro.body.faseSequencial, true); assert.equal(postsBatch, postsAntesSoCaro, '100% alto risco não cria POST Batch'); const soCaroConcluido = await aguardarJob(servidor.base, cookie, loteSoCaro.body.jobId, ['concluido'], 180); assert.equal(chamadasSyncIniciais, syncAntesSoCaro + 1); assert.equal(soCaroConcluido.rascunhosGerados, 1); assert.equal(soCaroConcluido.providerBatchId, undefined); await parar(servidor.app);

  requestsCriados = []; batchTerminou = true;
  const dataTetoHibrido = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-batch-teto-hibrido-')); criarBanco(dataTetoHibrido, 2, false); tornarAltoRisco(dataTetoHibrido, ['9920002']);
  const syncAntesTeto = chamadasSyncIniciais;
  servidor = await iniciarApp(dataTetoHibrido, porta + 3010, { PRECO_OPUS_4_8_SAIDA_MTOK_USD: '100000', ORCAMENTO_IA_MENSAL_USD: '100' }); cookie = await login(servidor.base); const loteTeto = await post(servidor.base, '/api/entrega/corrigir-todas', cookie, { id: 'p1' }); assert.equal(loteTeto.status, 202, JSON.stringify(loteTeto.body)); const tetoConcluido = await aguardarJob(servidor.base, cookie, loteTeto.body.jobId, ['concluido'], 240); assert.equal(chamadasSyncIniciais, syncAntesTeto, 'teto bloqueia a chamada cara antes de chegar ao provedor'); assert.equal(tetoConcluido.itens.find(i => i.matricula === '9920002').status, 'falhou-sem-orcamento'); const bancoTeto = JSON.parse(fs.readFileSync(path.join(dataTetoHibrido, 'db.json'), 'utf8')); assert.ok(bancoTeto.entregas.p1['9920001'].relatorio, 'item econômico do batch é preservado'); assert.equal(bancoTeto.entregas.p1['9920002'].relatorio, undefined); assert.equal(bancoTeto.gastos[mes]['prof:admin-batch'].porOperacao['correcao-padrao-batch'].usd, 1.2); await parar(servidor.app);

  resultadoEspecial = 'resultados-404'; batchTerminou = true; requestsCriados = [];
  const dataIndisponivel = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-batch-indisponivel-')); criarBanco(dataIndisponivel, 1, false);
  servidor = await iniciarApp(dataIndisponivel, porta + 3311); cookie = await login(servidor.base); const loteIndisponivel = await post(servidor.base, '/api/entrega/corrigir-todas', cookie, { id: 'p1' }); const indisponivel = await aguardarJob(servidor.base, cookie, loteIndisponivel.body.jobId, ['resultados-indisponiveis'], 180); assert.ok(indisponivel.reservaOrcamentoUSD > 0);
  const reconIndisponivel = await post(servidor.base, '/api/lotes-anthropic/reconciliar', cookie, { job: loteIndisponivel.body.jobId, confirmacao: 'LIBERAR RESERVA', motivo: 'Conferi no Console o custo do lote cujos resultados já expiraram.' }); assert.equal(reconIndisponivel.status, 200, JSON.stringify(reconIndisponivel.body)); const consultasAposRecon = consultasBatch;
  for (let i = 0; i < 3; i++) { const status = await fetch(servidor.base + '/api/entrega/corrigir-todas-status?job=' + loteIndisponivel.body.jobId, { headers: { cookie } }); const d = await status.json(); assert.equal(d.job.status, 'pendencia-batch-reconciliada'); assert.equal(d.job.reservaOrcamentoUSD, 0); }
  await esperar(300); assert.equal(consultasBatch, consultasAposRecon, 'status terminal reconciliado nunca repolla o provedor'); await parar(servidor.app);
  servidor = await iniciarApp(dataIndisponivel, porta + 3311); cookie = await login(servidor.base); await esperar(350); const statusReidratado = await fetch(servidor.base + '/api/entrega/corrigir-todas-status?job=' + loteIndisponivel.body.jobId, { headers: { cookie } }); const corpoReidratado = await statusReidratado.json(); assert.equal(corpoReidratado.job.status, 'pendencia-batch-reconciliada'); assert.equal(corpoReidratado.job.reservaOrcamentoUSD, 0); assert.equal(consultasBatch, consultasAposRecon, 'restart não repolla lote reconciliado'); const exclusaoLiberada = await post(servidor.base, '/api/peca/excluir', cookie, { id: 'p1' }); assert.equal(exclusaoLiberada.status, 200, 'reconciliação destrava a peça'); await parar(servidor.app);

  resultadoEspecial = '';

  resultadoEspecial = 'cancelado'; batchTerminou = true; requestsCriados = [];
  const dataCancelado = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-batch-cancelado-')); criarBanco(dataCancelado, 1, false);
  servidor = await iniciarApp(dataCancelado, porta + 1505); cookie = await login(servidor.base);
  const loteCancelado = await post(servidor.base, '/api/entrega/corrigir-todas', cookie, { id: 'p1' });
  const cancelado = await aguardarJob(servidor.base, cookie, loteCancelado.body.jobId, ['concluido'], 180); assert.equal(cancelado.cancelados, 1); assert.equal(cancelado.itens[0].fallbackSincrono, undefined, 'cancelamento do provedor não pode ser desfeito por retry síncrono'); assert.equal(cancelado.reservaOrcamentoUSD, 0);
  const bancoCancelado = JSON.parse(fs.readFileSync(path.join(dataCancelado, 'db.json'), 'utf8')); assert.equal(bancoCancelado.entregas.p1['9920001'].relatorio, undefined); assert.equal(bancoCancelado.gastos[mes], undefined, 'resultado cancelado não é cobrado'); await parar(servidor.app);

  resultadoEspecial = 'sem-usage'; batchTerminou = true; requestsCriados = [];
  const dataSemUsage = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-batch-sem-usage-')); criarBanco(dataSemUsage, 1, false);
  servidor = await iniciarApp(dataSemUsage, porta + 1806); cookie = await login(servidor.base);
  const loteSemUsage = await post(servidor.base, '/api/entrega/corrigir-todas', cookie, { id: 'p1' });
  const semUsage = await aguardarItem(servidor.base, cookie, loteSemUsage.body.jobId, 'aguardando-usage', 180); assert.ok(semUsage.reservaOrcamentoUSD > 0); assert.equal(semUsage.itens[0].resultadoProcessadoEm, undefined); assert.equal(semUsage.itens[0].liquidado, false);
  const bancoSemUsage = JSON.parse(fs.readFileSync(path.join(dataSemUsage, 'db.json'), 'utf8')); assert.equal(bancoSemUsage.entregas.p1['9920001'].relatorio, undefined, 'succeeded sem usage não pode ser aplicado'); await parar(servidor.app);

  console.log('OK: Message Batches real, retomada, ordem livre, idempotência, fator 0,5, fingerprint e fallback validados.');
}

executar().catch(err => { console.error(err.stack || err); process.exitCode = 1; }).finally(async () => { for (const app of Array.from(appsAtivos)) await parar(app); await new Promise(resolve => anthropic.close(resolve)); });
