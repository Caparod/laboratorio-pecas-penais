const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { casoTeste, gabaritoTeste } = require('./fixture-peca');
const { snapshotCanonico, registrarSnapshotPeca, snapshotDaEntrega } = require('../snapshot-peca');

function hashSenha(senha, salt) { return salt + ':' + crypto.scryptSync(senha, salt, 32).toString('hex'); }
function portaLivre() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const porta = server.address().port; server.close(erro => erro ? reject(erro) : resolve(porta)); });
  });
}
async function esperarServidor(url, child, logs) {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode != null) throw new Error('Servidor encerrou durante o boot.\n' + logs());
    try { const resposta = await fetch(url); if (resposta.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Servidor não iniciou.\n' + logs());
}
function encerrar(child) {
  if (child.exitCode != null) return Promise.resolve();
  return new Promise(resolve => { child.once('exit', resolve); child.kill(); });
}

async function testarBootSemInflacao(p, ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-boot-'));
  const agora = Date.now();
  const admin = { login: 'admin-snapshot', senha: hashSenha('Admin-Snapshot-2026', 'sal-snapshot'), mudouSenha: true, nome: 'Administrador', papel: 'Administrador' };
  const peca = Object.assign({ id: 'p1', num: 1, autor: admin.login, historico: [] }, p);
  const entrega = { texto: 'Texto acadêmico entregue com fundamentação, desenvolvimento, aplicação ao caso concreto, pedidos e fechamento suficientes.', enviadoEm: agora, nome: 'Aluno', turmaId: 't1', versaoPeca: p.versao, snapshotPecaRef: ref, snapshotCapturadoEm: agora };
  const entregaRefAusente = Object.assign({}, entrega, { nome: 'Aluno com referência ausente', snapshotPecaRef: 'b'.repeat(64) });
  const db = {
    turmaAtiva: 'Turma Snapshot', professor: admin, professores: {},
    turmas: { t1: { id: 't1', nome: 'Turma Snapshot', professores: [admin.login], criadaEm: agora } }, proximaTurma: 2,
    alunos: {
      '9900001': { nome: 'Aluno', senha: hashSenha('Aluno-Snapshot-2026', 'sal-aluno'), mudouSenha: true, turmaId: 't1', turmaIds: ['t1'] },
      '9900002': { nome: 'Aluno com referência ausente', senha: hashSenha('Aluno-Snapshot-2026', 'sal-aluno-2'), mudouSenha: true, turmaId: 't1', turmaIds: ['t1'] }
    },
    pecas: { p1: peca }, proximoNum: 2, entregas: { p1: { '9900001': entrega, '9900002': entregaRefAusente } }, sessoes: {}, gastos: {}
  };
  const dbPath = path.join(dir, 'db.json');
  fs.writeFileSync(dbPath, JSON.stringify(db));
  const porta = await portaLivre();
  let log = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { DATA_DIR: dir, PORT: String(porta), PROF_LOGIN: admin.login, PROF_SENHA: 'Admin-Snapshot-2026', CRIAR_CONTAS_DEMO: 'false', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', b => { log += b; }); child.stderr.on('data', b => { log += b; });
  try {
    await esperarServidor('http://127.0.0.1:' + porta + '/api/versao', child, () => log);
    const salvo = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const entregaSalva = salvo.entregas.p1['9900001'];
    assert.equal(entregaSalva.snapshotPecaRef, ref);
    assert.ok(!Object.prototype.hasOwnProperty.call(entregaSalva, 'snapshotPeca'), 'boot não deve recriar fotografia completa quando a referência existe');
    assert.equal(Object.keys(salvo.pecas.p1.snapshots || {}).length, 1, 'boot não deve duplicar o repositório imutável');
    assert.equal(salvo.pecas.p1.snapshots[ref].caso, p.snapshots[ref].caso);
    assert.equal(salvo.pecas.p1.snapshots[ref].gab, p.snapshots[ref].gab);
    assert.ok(!Object.prototype.hasOwnProperty.call(salvo.entregas.p1['9900002'], 'snapshotPeca'), 'boot não pode mascarar referência quebrada criando snapshot da versão atual');

    const base = 'http://127.0.0.1:' + porta;
    const loginResposta = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuario: admin.login, senha: 'Admin-Snapshot-2026' }) });
    const login = await loginResposta.json();
    assert.equal(loginResposta.status, 200, JSON.stringify(login));
    const cookie = String(loginResposta.headers.get('set-cookie') || '').split(';')[0];
    const bloqueada = await fetch(base + '/api/entrega?id=p1&matricula=9900002', { headers: { cookie } });
    const corpoBloqueado = await bloqueada.json();
    assert.equal(bloqueada.status, 409, 'exibição avaliativa com ref ausente deve ser bloqueada: ' + JSON.stringify(corpoBloqueado));
    assert.equal(corpoBloqueado.erro, 'SNAPSHOT_PECA_INDISPONIVEL');
    assert.match(corpoBloqueado.mensagem || '', /não usar silenciosamente uma versão diferente/i);
  } finally {
    await encerrar(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function executar() {
  const casoOriginal = casoTeste();
  const gabOriginal = gabaritoTeste('Apelação Criminal');
  const p = {
    versao: 3, rodada: 2, nomePeca: 'Apelação Criminal', disc: 'Turma Snapshot', turmaId: 't1',
    caso: casoOriginal, gab: gabOriginal, prazo: '2099-12-31T23:59', publicarEm: '', publicada: true
  };

  const legado = { versao: 1, nomePeca: 'Resposta à Acusação', caso: 'Caso legado', gab: 'Gabarito legado', capturadoEm: 123, legado: true };
  assert.deepEqual(snapshotDaEntrega(p, { snapshotPeca: legado }), snapshotCanonico(legado), 'snapshot legado deve continuar autoritativo sem ser alterado no banco');
  assert.equal(legado.capturadoEm, 123, 'a leitura não pode compactar nem modificar o objeto legado');

  const ref1 = registrarSnapshotPeca(p, Object.assign({}, p, { capturadoEm: 111, metadadoEntrega: 'ignorar' }));
  const ref2 = registrarSnapshotPeca(p, Object.assign({}, p, { capturadoEm: 999, outroMetadado: true }));
  assert.equal(ref1, ref2, 'duas entregas do mesmo conteúdo/versão devem reutilizar o mesmo SHA-256');
  assert.equal(Object.keys(p.snapshots).length, 1, 'deve existir uma única fotografia por conteúdo/versão');

  const entregaA = { versaoPeca: 3, snapshotPecaRef: ref1, snapshotCapturadoEm: 111, nome: 'Aluno A' };
  const entregaB = { versaoPeca: 3, snapshotPecaRef: ref2, snapshotCapturadoEm: 999, nome: 'Aluno B' };
  for (const entrega of [entregaA, entregaB]) {
    assert.ok(!Object.prototype.hasOwnProperty.call(entrega, 'snapshotPeca'));
    assert.ok(!Object.prototype.hasOwnProperty.call(entrega, 'caso'), 'entrega por referência não deve duplicar o enunciado');
    assert.ok(!Object.prototype.hasOwnProperty.call(entrega, 'gab'), 'entrega por referência não deve duplicar o gabarito');
    assert.deepEqual(snapshotDaEntrega(p, entrega), snapshotCanonico(p));
  }

  p.versao = 4;
  p.caso = 'Enunciado posteriormente editado que não pode substituir o original da entrega.';
  p.gab = gabaritoTeste('Agravo em Execução');
  p.nomePeca = 'Agravo em Execução';
  const originalResolvido = snapshotDaEntrega(p, entregaA);
  assert.equal(originalResolvido.caso, casoOriginal, 'edição posterior deve preservar o enunciado original da entrega');
  assert.equal(originalResolvido.gab, gabOriginal, 'edição posterior deve preservar a fotografia original');

  assert.throws(
    () => snapshotDaEntrega(p, { snapshotPecaRef: 'a'.repeat(64), versaoPeca: 3 }),
    erro => erro && erro.code === 'SNAPSHOT_PECA_INDISPONIVEL' && /bloqueada/i.test(erro.message),
    'referência ausente deve bloquear claramente, sem fallback para a peça atual'
  );
  const snapshotGuardado = p.snapshots[ref1];
  p.snapshots[ref1] = Object.assign({}, snapshotGuardado, { caso: 'conteúdo adulterado' });
  assert.throws(() => snapshotDaEntrega(p, entregaA), erro => erro && erro.code === 'SNAPSHOT_PECA_INDISPONIVEL' && /integridade inválida/i.test(erro.message));
  p.snapshots[ref1] = snapshotGuardado;

  const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(servidor, /e\.snapshotPeca\s*\|\|\s*fotografiaPeca/, 'leituras avaliativas não podem manter fallback silencioso para a versão atual');
  assert.doesNotMatch(servidor, /e\s*&&\s*e\.snapshotPeca\s*\?/, 'exibição deve usar o resolvedor central');
  assert.match(servidor, /snapshotPecaRef:\s*registrarFotografiaImutavel\(p\)/, 'novas entregas externas devem persistir somente a referência');

  await testarBootSemInflacao(p, ref1);
  console.log('OK: snapshots legados e por referência são íntegros, deduplicados e seguros no boot.');
}

executar().catch(erro => { console.error(erro.stack || erro); process.exitCode = 1; });
