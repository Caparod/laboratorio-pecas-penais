const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const appDir = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-zerar-'));
const port = 31000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;
const adminLogin = 'admin-teste';
const server = spawn(process.execPath, ['server.js'], {
  cwd: appDir,
  env: Object.assign({}, process.env, { DATA_DIR: dataDir, PORT: String(port), PROF_LOGIN: adminLogin, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }),
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverLog = '';
server.stdout.on('data', b => { serverLog += b; });
server.stderr.on('data', b => { serverLog += b; });

async function esperarServidor() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(base); if (r.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Servidor não iniciou.\n' + serverLog);
}

async function requisitar(url, token, body, headers) {
  const h = Object.assign({ 'content-type': 'application/json' }, headers || {});
  if (token) h.authorization = 'Bearer ' + token;
  const r = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, body: d };
}

async function login(usuario, senha) {
  const r = await requisitar('/api/login', null, { usuario, senha });
  assert.equal(r.status, 200, `login de ${usuario}: ${JSON.stringify(r.body)}`);
  return r.body.token;
}

async function executar() {
  await esperarServidor();
  const coordenador = await login('Any', '123456');
  const admin = await login(adminLogin, adminLogin);

  let r = await requisitar('/api/professores/salvar', coordenador, { login: 'prof-teste', nome: 'Professor Teste', papel: 'Professor' });
  assert.equal(r.status, 200);
  const professor = await login('prof-teste', 'prof-teste');

  r = await requisitar('/api/turmas/salvar', coordenador, { nome: 'Turma do Professor', professores: ['prof-teste'] });
  assert.equal(r.status, 200); const turmaPropria = r.body.id;
  r = await requisitar('/api/turmas/salvar', coordenador, { nome: 'Turma Alheia', professores: ['Any'] });
  assert.equal(r.status, 200); const turmaAlheia = r.body.id;

  r = await requisitar('/api/admin', coordenador, { turmaId: turmaPropria, matriculas: [{ matricula: '9000001', nome: 'Aluno Próprio' }] });
  assert.equal(r.status, 200);
  r = await requisitar('/api/admin', coordenador, { turmaId: turmaAlheia, matriculas: [{ matricula: '9000002', nome: 'Aluno Alheio' }] });
  assert.equal(r.status, 200);
  const alunoProprio = await login('9000001', '9000001');

  r = await requisitar('/api/peca/salvar', professor, { nomePeca: 'Peça da turma própria', caso: 'Caso de teste com conteúdo suficiente.', gab: 'Gabarito de teste.', turmaId: turmaPropria, publicada: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await requisitar('/api/peca/salvar', coordenador, { nomePeca: 'Peça da turma alheia', caso: 'Outro caso de teste com conteúdo suficiente.', gab: 'Outro gabarito.', turmaId: turmaAlheia, publicada: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  r = await requisitar('/api/zerar', professor, { escopo: 'turma', turmaId: turmaAlheia, confirmacao: 'ZERAR TURMA' });
  assert.equal(r.status, 403, 'professor não pode zerar turma alheia');
  r = await requisitar('/api/zerar', professor, { escopo: 'sistema', confirmacao: 'ZERAR' });
  assert.equal(r.status, 403, 'professor não pode zerar o sistema');
  r = await requisitar('/api/zerar', coordenador, { escopo: 'sistema', confirmacao: 'ZERAR' });
  assert.equal(r.status, 403, 'coordenação não pode zerar o sistema');

  r = await requisitar('/api/zerar', professor, { escopo: 'turma', turmaId: turmaPropria, confirmacao: 'ZERAR TURMA' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.alunosApagados, 1);
  assert.equal(r.body.pecasApagadas, 1);
  r = await requisitar('/api/pecas-aluno', alunoProprio);
  assert.equal(r.status, 401, 'sessão do aluno apagado deve ser invalidada');

  r = await requisitar('/api/zerar', coordenador, { escopo: 'turma', turmaId: turmaAlheia, confirmacao: 'ZERAR TURMA' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.alunosApagados, 1);
  assert.equal(r.body.pecasApagadas, 1);

  r = await requisitar('/api/admin', coordenador, { turmaId: turmaAlheia, matriculas: [{ matricula: '9000003', nome: 'Aluno Final' }] });
  assert.equal(r.status, 200);
  r = await requisitar('/api/zerar', admin, { escopo: 'sistema', confirmacao: 'ZERAR' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.alunosApagados, 1);

  const banco = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.equal(Object.keys(banco.alunos).length, 0);
  assert.equal(Object.keys(banco.pecas).length, 0);
  assert.ok(banco.turmas[turmaPropria], 'zerar preserva o cadastro da turma');
  assert.ok(banco.turmas[turmaAlheia], 'zerar preserva o cadastro da turma');
  console.log('OK: permissões e limpeza por turma/sistema validadas.');
}

executar().catch(e => { console.error(e.stack || e); process.exitCode = 1; }).finally(() => {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
