const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function hashSenha(senha, salt) {
  return salt + ':' + crypto.scryptSync(senha, salt, 32).toString('hex');
}
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
async function portaLivre() {
  const net = require('net');
  return new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); }); s.on('error', reject); });
}
async function esperar(url) {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Servidor não iniciou.');
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recuperacao-senha-'));
  const tokenConhecido = crypto.randomBytes(32).toString('base64url');
  const db = {
    turmaAtiva: 'Estágio I', professores: {}, pecas: {}, entregas: {}, turmas: { t1: { id: 't1', nome: 'T1', professores: ['admin'] } }, proximoNum: 1,
    professor: { login: 'admin', senha: hashSenha('Admin-Teste-2026', 'sal-admin'), mudouSenha: true },
    alunos: {
      '9900001': { nome: 'Aluno Recuperação', senha: hashSenha('Senha-Antiga-2026', 'sal-aluno-a'), mudouSenha: true, email: 'aluno@example.test', emailVerificado: true, whatsapp: '+5561999999999', turmaId: 't1', turmaIds: ['t1'] },
      '9900002': { nome: 'Aluno Token', senha: hashSenha('Outra-Antiga-2026', 'sal-aluno-b'), mudouSenha: true, email: 'token@example.test', emailVerificado: true, whatsapp: '+5561999999998', turmaId: 't1', turmaIds: ['t1'], recuperacaoSenhaHash: hashToken(tokenConhecido), recuperacaoSenhaExpiraEm: Date.now() + 600000 }
    }, sessoes: {}
  };
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(db));
  const port = await portaLivre();
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { DATA_DIR: dir, PORT: String(port), PROF_LOGIN: 'admin', PROF_SENHA: 'Admin-Teste-2026', CRIAR_CONTAS_DEMO: 'false', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '' }), stdio: ['ignore', 'pipe', 'pipe'] });
  const base = 'http://127.0.0.1:' + port;
  async function post(rota, body, cookie) { const headers = { 'content-type': 'application/json' }; if (cookie) headers.cookie = cookie; const r = await fetch(base + rota, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, body: await r.json(), cookie: String(r.headers.get('set-cookie') || '').split(';')[0] }; }
  try {
    await esperar(base + '/api/versao');
    const inexistente = await post('/api/esqueci-senha', { usuario: 'nao-existe' });
    const existente = await post('/api/esqueci-senha', { usuario: '9900001' });
    assert.equal(inexistente.status, 200); assert.deepEqual(inexistente.body, existente.body, 'resposta não pode revelar matrícula cadastrada');
    await new Promise(r => setTimeout(r, 50));
    const disco = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    assert.ok(!JSON.stringify(disco).includes(tokenConhecido), 'token bruto jamais pode ser persistido');

    const loginAntigo = await post('/api/login', { usuario: '9900002', senha: 'Outra-Antiga-2026' });
    assert.equal(loginAntigo.status, 200);
    const redefiniu = await post('/api/redefinir-senha', { token: tokenConhecido, novaSenha: 'Nova-Senha-Segura-2026' });
    assert.equal(redefiniu.status, 200, JSON.stringify(redefiniu.body));
    const sessaoAntiga = await fetch(base + '/api/sessao', { headers: { cookie: loginAntigo.cookie } });
    assert.equal(sessaoAntiga.status, 401, 'redefinição deve encerrar sessões existentes');
    assert.equal((await post('/api/login', { usuario: '9900002', senha: 'Outra-Antiga-2026' })).status, 401, 'senha anterior deve deixar de funcionar');
    assert.equal((await post('/api/login', { usuario: '9900002', senha: 'Nova-Senha-Segura-2026' })).status, 200, 'nova senha deve autenticar');
    assert.equal((await post('/api/redefinir-senha', { token: tokenConhecido, novaSenha: 'Terceira-Senha-2026' })).status, 400, 'token deve ser de uso único');
    const final = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')).alunos['9900002'];
    assert.ok(!final.recuperacaoSenhaHash && !final.recuperacaoSenhaExpiraEm, 'token usado deve ser removido');
    console.log('OK: recuperação de senha é genérica, temporária, de uso único e invalida sessões antigas.');
  } finally { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
