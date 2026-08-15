const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { casoTeste, gabaritoTeste } = require('./fixture-peca');

function hashSenha(senha, salt) { return salt + ':' + crypto.scryptSync(senha, salt, 32).toString('hex'); }
async function portaLivre() {
  const net = require('net');
  return new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); }); s.on('error', reject); });
}
async function esperar(url) {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Servidor não iniciou.');
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alteracao-tipo-'));
  const caso = casoTeste(), gab = gabaritoTeste('Apelação Criminal');
  const db = {
    turmaAtiva: 'Turma 1',
    professor: { login: 'admin', senha: hashSenha('Admin-Tipo-2026', 'sal-admin'), mudouSenha: true, nome: 'Administrador', papel: 'Administrador', aceitePrivacidadeEm: Date.now(), versaoPrivacidade: '2026-08' },
    professores: {}, turmas: { t1: { id: 't1', nome: 'Turma 1', professores: ['admin'], criadaEm: Date.now() } }, proximaTurma: 2,
    alunos: { '9900010': { nome: 'Aluno', senha: hashSenha('Aluno-Tipo-2026', 'sal-aluno'), mudouSenha: true, email: 'aluno@example.test', emailVerificado: true, whatsapp: '+5561999999999', turmaId: 't1', turmaIds: ['t1'] } },
    pecas: { p2: { id: 'p2', num: 2, rodada: 2, nomePeca: 'Queixa-Crime', disc: 'Turma 1', turmaId: 't1', caso, gab, prazo: '2099-12-31T23:59', publicada: true, autor: 'admin', versao: 1, historico: [] } }, proximoNum: 3,
    entregas: { p2: { '9900010': { nome: 'Aluno', texto: 'Texto entregue para preservar durante a correção do tipo da peça.', enviadoEm: Date.now(), turmaId: 't1', snapshotPeca: { versao: 1, nomePeca: 'Queixa-Crime', disc: 'Turma 1', caso, gab } } } }, sessoes: {}, gastos: {}
  };
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(db));
  const port = await portaLivre();
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { DATA_DIR: dir, PORT: String(port), PROF_LOGIN: 'admin', PROF_SENHA: 'Admin-Tipo-2026', CRIAR_CONTAS_DEMO: 'false', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }), stdio: ['ignore', 'pipe', 'pipe'] });
  const base = 'http://127.0.0.1:' + port;
  async function post(rota, body, cookie) { const h = { 'content-type': 'application/json' }; if (cookie) h.cookie = cookie; const r = await fetch(base + rota, { method: 'POST', headers: h, body: JSON.stringify(body) }); return { status: r.status, body: await r.json(), cookie: String(r.headers.get('set-cookie') || '').split(';')[0] }; }
  try {
    await esperar(base + '/api/versao');
    const login = await post('/api/login', { usuario: 'admin', senha: 'Admin-Tipo-2026' });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    const alteracao = await post('/api/peca/tipo', { id: 'p2', nomePeca: 'Apelação Criminal', aplicarAoHistorico: true }, login.cookie);
    assert.equal(alteracao.status, 200, JSON.stringify(alteracao.body));
    assert.equal(alteracao.body.entregasAtualizadas, 1);
    const r = await fetch(base + '/api/peca/get?id=p2', { headers: { cookie: login.cookie } });
    const atual = (await r.json()).peca;
    assert.equal(atual.nomePeca, 'Apelação Criminal');
    assert.equal(atual.caso, caso, 'narrativa deve ser preservada byte a byte');
    assert.equal(atual.gab, gab, 'gabarito deve ser preservado byte a byte');
    assert.equal(atual.rodada, 2, 'numeração deve ser preservada');
    const disco = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    assert.equal(disco.entregas.p2['9900010'].snapshotPeca.nomePeca, 'Apelação Criminal', 'correção cadastral deve atualizar o rótulo da entrega antiga');
    assert.equal(disco.entregas.p2['9900010'].texto, db.entregas.p2['9900010'].texto, 'entrega não pode ser alterada');
    assert.equal(disco.pecas.p2.auditoriaTipo[0].de, 'Queixa-Crime');
    assert.equal(disco.pecas.p2.auditoriaTipo[0].para, 'Apelação Criminal');
    console.log('OK: tipo da peça alterado com narrativa, gabarito, numeração e entregas preservados.');
  } finally { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
