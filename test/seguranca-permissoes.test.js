const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const appDir = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-seguranca-'));
const port = 33000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;
const adminLogin = 'admin-auditoria';
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

async function requisitar(url, token, body) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = 'Bearer ' + token;
  const r = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, body: data, headers: r.headers };
}

async function loginBruto(usuario, senha) {
  const r = await requisitar('/api/login', null, { usuario, senha });
  assert.equal(r.status, 200, `login de ${usuario}: ${JSON.stringify(r.body)}`);
  return r.body;
}

async function trocarSenha(token, novaSenha, email) {
  const r = await requisitar('/api/trocar-senha', token, { novaSenha, email });
  assert.equal(r.status, 200, `troca de senha: ${JSON.stringify(r.body)}`);
  return r;
}

async function executar() {
  await esperarServidor();

  const pagina = await fetch(base);
  assert.equal(pagina.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(pagina.headers.get('x-frame-options'), 'DENY');
  assert.match(pagina.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);

  const coord1 = await loginBruto('Any', '123456');
  const coord2 = await loginBruto('Any', '123456');
  let r = await requisitar('/api/turmas', coord1.token);
  assert.equal(r.status, 403, 'senha inicial não pode acessar APIs do sistema');
  assert.equal(r.body.erro, 'TROCAR_SENHA');
  await trocarSenha(coord1.token, 'Coord-Segura-2026');
  r = await requisitar('/api/admin', coord2.token, {});
  assert.equal(r.status, 401, 'troca de senha deve invalidar as outras sessões');
  const coordenador = coord1.token;

  const adminInicial = await loginBruto(adminLogin, adminLogin);
  await trocarSenha(adminInicial.token, 'Admin-Segura-2026');
  const admin = adminInicial.token;
  r = await requisitar('/api/admin', admin, {});
  assert.equal(r.status, 200);

  r = await requisitar('/api/professores/salvar', coordenador, { login: 'prof-auditoria', nome: 'Professor Auditoria', papel: 'Professor' });
  assert.equal(r.status, 200);
  const profInicial = await loginBruto('prof-auditoria', 'prof-auditoria');
  await trocarSenha(profInicial.token, 'Prof-Segura-2026');
  const professor = profInicial.token;

  r = await requisitar('/api/turmas/salvar', coordenador, { nome: 'Turma A', professores: ['prof-auditoria'] });
  assert.equal(r.status, 200); const turmaA = r.body.id;
  r = await requisitar('/api/turmas/salvar', coordenador, { nome: 'Turma B', professores: ['Any'] });
  assert.equal(r.status, 200); const turmaB = r.body.id;

  r = await requisitar('/api/admin', coordenador, { turmaId: turmaB, matriculas: [{ matricula: '9100002', nome: 'Aluno B' }] });
  assert.equal(r.status, 200);
  r = await requisitar('/api/admin', professor, { turmaId: turmaA, matriculas: [{ matricula: '9100002', nome: 'Aluno B' }] });
  assert.equal(r.status, 200, 'matrícula existente pode ser adicionada a outra turma');
  let banco = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.deepEqual(new Set(banco.alunos['9100002'].turmaIds), new Set([turmaA, turmaB]), 'aluno deve manter os dois vínculos');
  r = await requisitar('/api/admin', coordenador, { excluirTodos: true, confirmacao: 'EXCLUIR TODOS' });
  assert.equal(r.status, 403, 'coordenação não pode excluir todos os alunos do sistema');
  r = await requisitar('/api/admin', coordenador, { substituir: true, matriculas: [] });
  assert.equal(r.status, 400, 'substituição sempre exige uma turma');

  r = await requisitar('/api/admin', coordenador, { turmaId: turmaA, matriculas: [{ matricula: '9100001', nome: 'Aluno A' }] });
  assert.equal(r.status, 200);
  const alunoInicial = await loginBruto('9100001', '9100001');
  await trocarSenha(alunoInicial.token, 'Aluno-Seguro-2026', 'aluno-a@example.test');
  banco = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  const codigo = banco.alunos['9100001'].codigoVerif;
  r = await requisitar('/api/verificar-email', alunoInicial.token, { codigo });
  assert.equal(r.status, 200);

  r = await requisitar('/api/peca/salvar', professor, { nomePeca: 'Peça auditada', caso: 'Caso de teste com conteúdo suficiente para a auditoria.', gab: 'Gabarito de teste.', turmaId: turmaA, publicar: true });
  assert.equal(r.status, 200, JSON.stringify(r.body)); const pecaId = r.body.id;
  r = await requisitar('/api/peca/salvar', coordenador, { nomePeca: 'Peça da segunda turma', caso: 'Segundo caso de teste com conteúdo suficiente para a auditoria.', gab: 'Segundo gabarito.', turmaId: turmaB, publicar: true });
  assert.equal(r.status, 200, JSON.stringify(r.body)); const pecaBId = r.body.id;
  const alunoBInicial = await loginBruto('9100002', '9100002');
  await trocarSenha(alunoBInicial.token, 'Aluno-Duas-Turmas-2026', 'aluno-b@example.test');
  r = await requisitar('/api/pecas-aluno', alunoBInicial.token);
  assert.equal(r.status, 200);
  assert.deepEqual(new Set(r.body.pecas.map(p => p.id)), new Set([pecaId, pecaBId]), 'aluno deve acessar peças das duas turmas');
  r = await requisitar('/api/entregar', alunoInicial.token, { id: pecaId, texto: 'Texto de entrega suficientemente longo para validar a limpeza completa de dados da turma durante o teste automatizado.' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await requisitar('/api/gabarito', alunoInicial.token, { peca: { nome: 'Teste', gab: 'Teste' } });
  assert.equal(r.status, 403, 'aluno não pode acionar gabarito de IA reservado ao professor');
  r = await requisitar('/api/gerar-caso', alunoInicial.token, { peca: { nome: 'Teste' } });
  assert.equal(r.status, 403, 'aluno não pode acionar geração de caso reservada ao professor');

  r = await requisitar('/api/admin', professor, { resetarSenha: '9100001' });
  assert.equal(r.status, 200);
  r = await requisitar('/api/pecas-aluno', alunoInicial.token);
  assert.equal(r.status, 401, 'reset de senha deve invalidar sessões do aluno');

  r = await requisitar('/api/turmas/salvar', coordenador, { id: turmaA, nome: 'Turma A', professores: ['Any'] });
  assert.equal(r.status, 200);
  r = await requisitar('/api/peca/get?id=' + encodeURIComponent(pecaId), professor);
  assert.equal(r.status, 403, 'professor removido da turma não pode ler peça que criou');
  r = await requisitar('/api/peca/excluir', professor, { id: pecaId });
  assert.equal(r.status, 403, 'professor removido da turma não pode excluir peça que criou');

  r = await requisitar('/api/turmas/excluir', coordenador, { id: turmaA });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.alunosApagados, 1);
  assert.equal(r.body.alunosMantidos, 1);
  assert.equal(r.body.vinculosRemovidos, 2);
  assert.equal(r.body.pecasApagadas, 1);
  assert.equal(r.body.entregasApagadas, 1);
  banco = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.ok(!banco.alunos['9100001']);
  assert.ok(!banco.pecas[pecaId]);
  assert.ok(banco.pecas[pecaBId], 'peça da outra turma deve ser preservada');
  assert.ok(!banco.entregas[pecaId]);
  assert.ok(banco.alunos['9100002'], 'aluno compartilhado deve permanecer cadastrado');
  assert.deepEqual(banco.alunos['9100002'].turmaIds, [turmaB], 'somente o vínculo da turma excluída deve ser removido');
  r = await requisitar('/api/pecas-aluno', alunoBInicial.token);
  assert.equal(r.status, 200, 'sessão do aluno compartilhado deve continuar válida');
  assert.deepEqual(r.body.pecas.map(p => p.id), [pecaBId]);

  r = await requisitar('/api/logout', coordenador, {});
  assert.equal(r.status, 200);
  r = await requisitar('/api/admin', coordenador, {});
  assert.equal(r.status, 401, 'logout deve invalidar a sessão no servidor');

  console.log('OK: auditoria de sessão, senha, perfis, isolamento e limpeza validada.');
}

executar().catch(e => { console.error(e.stack || e); process.exitCode = 1; }).finally(() => {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

