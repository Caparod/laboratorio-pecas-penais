const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const appDir = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-sincronizacao-'));
const port = 35000 + Math.floor(Math.random() * 1500);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.js'], {
  cwd: appDir,
  env: Object.assign({}, process.env, { DATA_DIR: dataDir, PORT: String(port), CRIAR_CONTAS_DEMO: 'true', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }),
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverLog = '';
server.stdout.on('data', b => { serverLog += b; });
server.stderr.on('data', b => { serverLog += b; });

async function requisitar(url, token, body) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = 'Bearer ' + token;
  const r = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function executar() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
    if (i === 79) throw new Error('Servidor não iniciou.\n' + serverLog);
  }

  let r = await requisitar('/api/login', null, { usuario: 'Any', senha: '123456' });
  assert.equal(r.status, 200);
  const token = r.body.token;
  r = await requisitar('/api/trocar-senha', token, { novaSenha: 'Coord-Sincronizacao-2026' });
  assert.equal(r.status, 200);

  r = await requisitar('/api/turmas/salvar', token, { nome: 'Turma principal', professores: ['Any'] });
  assert.equal(r.status, 200); const turmaA = r.body.id;
  r = await requisitar('/api/turmas/salvar', token, { nome: 'Turma compartilhada', professores: ['Any'] });
  assert.equal(r.status, 200); const turmaB = r.body.id;

  r = await requisitar('/api/admin', token, {
    sincronizarLista: true,
    turmaId: turmaA,
    matriculas: [
      { matricula: '9200001', nome: 'Aluno Preservado' },
      { matricula: '9200002', nome: 'Aluno Compartilhado' },
      { matricula: '9200004', nome: 'Aluno a Excluir' }
    ]
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.novas, 3);
  assert.ok(r.body.credenciaisIniciais.every(c => c.senha === '12345678'), 'todos os novos logins devem usar a senha temporária padrão');

  r = await requisitar('/api/admin', token, { turmaId: turmaB, matriculas: [{ matricula: '9200002', nome: 'Nome que não pode sobrescrever' }, { matricula: '9200005', nome: 'Aluno já existente' }] });
  assert.equal(r.status, 200);
  let banco = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  const antes = JSON.parse(JSON.stringify(banco.alunos['9200001']));
  const compartilhadoAntes = JSON.parse(JSON.stringify(banco.alunos['9200002']));

  const listaNova = [
    { matricula: '9200001', nome: 'NOME NÃO DEVE MUDAR' },
    { matricula: '9200003', nome: 'Aluno Novo' },
    { matricula: '9200005', nome: 'OUTRO NOME NÃO DEVE MUDAR' }
  ];
  r = await requisitar('/api/admin', token, { sincronizarLista: true, turmaId: turmaA, matriculas: listaNova });
  assert.equal(r.status, 409, 'ausentes exigem uma etapa exclusiva de confirmação');
  assert.equal(r.body.erro, 'CONFIRMAR_EXCLUSOES');
  assert.deepEqual(new Set(r.body.resumo.ausentes.map(a => a.matricula)), new Set(['9200002', '9200004']));

  banco = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.ok(!banco.alunos['9200003'], 'a prévia não pode criar alunos antes da confirmação');
  assert.ok(banco.alunos['9200004'], 'a prévia não pode excluir alunos');
  assert.deepEqual(banco.alunos['9200001'], antes, 'a prévia não pode alterar aluno existente');

  r = await requisitar('/api/admin', token, { sincronizarLista: true, turmaId: turmaA, matriculas: listaNova, ausentesConfirmados: ['9200002'] });
  assert.equal(r.status, 409, 'a confirmação deve corresponder exatamente à prévia atual');

  r = await requisitar('/api/admin', token, { sincronizarLista: true, turmaId: turmaA, matriculas: listaNova, ausentesConfirmados: ['9200002', '9200004'] });
  assert.equal(r.status, 200);
  assert.equal(r.body.novas, 1);
  assert.equal(r.body.mantidos, 1);
  assert.equal(r.body.vinculadosExistentes, 1);
  assert.equal(r.body.removidosDaTurma, 2);
  assert.deepEqual(r.body.credenciaisIniciais, [{ matricula: '9200003', senha: '12345678' }]);

  banco = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.deepEqual(banco.alunos['9200001'], antes, 'aluno mantido deve ficar completamente intocado');
  assert.equal(banco.alunos['9200002'].nome, compartilhadoAntes.nome, 'aluno compartilhado deve preservar o cadastro');
  assert.deepEqual(banco.alunos['9200002'].turmaIds, [turmaB], 'aluno compartilhado deve sair apenas da turma sincronizada');
  assert.ok(!banco.alunos['9200004'], 'conta sem outra turma deve ser excluída após confirmação');
  assert.ok(banco.alunos['9200005'].turmaIds.includes(turmaA), 'aluno já existente deve receber apenas o novo vínculo');
  assert.equal(banco.alunos['9200003'].nome, 'Aluno Novo');

  console.log('OK: sincronização segura da lista de alunos validada.');
}

executar().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => server.kill());
