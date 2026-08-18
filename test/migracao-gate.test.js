const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const appDir = path.resolve(__dirname, '..');
const temporarios = [];
const processos = [];
const servidores = [];

function temp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporarios.push(dir);
  return dir;
}

function envApp(extras) {
  return Object.assign({}, process.env, {
    NODE_ENV: 'test',
    CRIAR_CONTAS_DEMO: 'false',
    PROF_LOGIN: 'admin-gate',
    PROF_SENHA: 'Admin-Gate-2026',
    GMAIL_USER: '',
    GMAIL_APP_PASSWORD: ''
  }, extras || {});
}

function iniciarApp(extras, stdio = 'ignore') {
  const processo = spawn(process.execPath, ['server.js'], { cwd: appDir, env: envApp(extras), stdio });
  processos.push(processo);
  return processo;
}

function aguardarSaida(processo, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      processo.kill();
      reject(new Error('O processo não encerrou no prazo esperado.'));
    }, timeoutMs);
    processo.once('exit', codigo => { clearTimeout(timer); resolve(codigo); });
  });
}

async function portaLivre() {
  const s = http.createServer();
  await new Promise((resolve, reject) => s.listen(0, '127.0.0.1', erro => erro ? reject(erro) : resolve()));
  const porta = s.address().port;
  await new Promise(resolve => s.close(resolve));
  return porta;
}

async function esperar(condicao, mensagem, timeoutMs = 8000) {
  const fim = Date.now() + timeoutMs;
  let ultimoErro;
  while (Date.now() < fim) {
    try {
      const resultado = await condicao();
      if (resultado) return resultado;
    } catch (e) { ultimoErro = e; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(mensagem + (ultimoErro ? '\n' + ultimoErro.message : ''));
}

function senhaHash(senha) {
  const salt = 'salt-gate-migracao';
  return salt + ':' + crypto.scryptSync(senha, salt, 32).toString('hex');
}

function baseLegada(marcador) {
  const professor = { login: 'admin-gate', senha: senhaHash('Admin-Gate-2026'), mudouSenha: true, nome: 'Administrador Gate', papel: 'Administrador' };
  return {
    marcador,
    turmaAtiva: 'Estágio I',
    alunos: {},
    professor,
    professores: { 'admin-gate': professor },
    pecas: {},
    proximoNum: 1,
    entregas: {},
    avisosProfessores: [],
    sessoes: {},
    gastos: {}
  };
}

function responderJson(res, status, corpo) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(corpo));
}

async function executar() {
  // Mesmo sem a nova env sincronizada, um serviço identificado como Render
  // nunca pode iniciar com persistência local acidental.
  const dirSemConfig = temp('laboratorio-gate-sem-config-');
  const semConfig = iniciarApp({
    DATA_DIR: dirSemConfig,
    PORT: '0',
    RENDER: 'true',
    NODE_ENV: 'production',
    npm_lifecycle_event: '',
    SUPABASE_REQUIRED: '',
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    SUPABASE_STATE_TABLE: '',
    SUPABASE_STATE_ID: ''
  });
  assert.notEqual(await aguardarSaida(semConfig), 0, 'Render sem Supabase deve falhar fechado');
  assert.ok(!fs.existsSync(path.join(dirSemConfig, 'db.json')), 'não deve criar main/local vazio quando falta a configuração obrigatória');

  let postsSemMain = 0;
  const supabaseSemMain = http.createServer((req, res) => {
    if (req.method === 'POST') postsSemMain++;
    responderJson(res, 200, []);
  });
  servidores.push(supabaseSemMain);
  await new Promise(resolve => supabaseSemMain.listen(0, '127.0.0.1', resolve));
  const dirSemMain = temp('laboratorio-gate-sem-main-');
  const semMain = iniciarApp({
    DATA_DIR: dirSemMain,
    PORT: '0',
    SUPABASE_REQUIRED: 'true',
    SUPABASE_URL: `http://127.0.0.1:${supabaseSemMain.address().port}`,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-teste',
    SUPABASE_STATE_TABLE: 'app_state',
    SUPABASE_STATE_ID: 'main'
  });
  assert.notEqual(await aguardarSaida(semMain), 0, 'ausência da linha main deve impedir o boot');
  assert.equal(postsSemMain, 0, 'ausência da linha main jamais pode provocar upsert de uma base vazia');
  assert.ok(!fs.existsSync(path.join(dirSemMain, 'db.json')), 'fallback local não pode ser salvo no modo obrigatório');
  await new Promise(resolve => supabaseSemMain.close(resolve));

  let estadoMain = baseLegada('primeira-leitura');
  let leiturasMain = 0;
  let mainSalvo = null;
  let upsertsMain = 0;
  const backups = new Map();
  const supabase = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const filtroId = String(url.searchParams.get('id') || '');
    const id = filtroId.startsWith('eq.') ? filtroId.slice(3) : '';
    if (req.method === 'GET') {
      if (id === 'main') {
        leiturasMain++;
        return responderJson(res, 200, [{ data: JSON.parse(JSON.stringify(estadoMain)) }]);
      }
      const backup = backups.get(id);
      return responderJson(res, 200, backup ? [{ id, data: JSON.parse(JSON.stringify(backup)) }] : []);
    }
    if (req.method === 'POST') {
      let corpo = '';
      for await (const pedaco of req) corpo += pedaco;
      const linha = JSON.parse(corpo);
      if (url.searchParams.get('on_conflict') === 'id') {
        assert.equal(linha.id, 'main');
        upsertsMain++;
        mainSalvo = JSON.parse(JSON.stringify(linha.data));
        estadoMain = mainSalvo;
      } else {
        assert.ok(String(linha.id).startsWith('backup-pre-migracao-main-'));
        if (backups.has(linha.id)) return responderJson(res, 409, { erro: 'duplicate key' });
        backups.set(linha.id, JSON.parse(JSON.stringify(linha.data)));
      }
      return responderJson(res, 201, {});
    }
    return responderJson(res, 405, {});
  });
  servidores.push(supabase);
  await new Promise(resolve => supabase.listen(0, '127.0.0.1', resolve));

  const portaApp = await portaLivre();
  const baseApp = `http://127.0.0.1:${portaApp}`;
  const app = iniciarApp({
    DATA_DIR: temp('laboratorio-gate-rolling-'),
    PORT: String(portaApp),
    SUPABASE_REQUIRED: 'true',
    SUPABASE_URL: `http://127.0.0.1:${supabase.address().port}`,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-teste',
    SUPABASE_STATE_TABLE: 'app_state',
    SUPABASE_STATE_ID: 'main',
    MIGRACAO_ROLLING_ESPERA_MS: '500'
  }, ['ignore', 'pipe', 'pipe']);
  let log = '';
  app.stdout.on('data', b => { log += b; });
  app.stderr.on('data', b => { log += b; });

  await esperar(async () => {
    const resposta = await fetch(baseApp);
    return resposta.ok && (await resposta.text()).includes('Atualização segura');
  }, 'o servidor não abriu em modo de manutenção\n' + log);
  assert.equal(leiturasMain, 1, 'a janela deve abrir depois da primeira leitura e antes da releitura');

  const versaoManutencao = await (await fetch(baseApp + '/api/versao')).json();
  assert.equal(versaoManutencao.manutencaoMigracao, true);
  assert.equal(versaoManutencao.fase, 'aguardando-dreno');
  assert.equal((await fetch(baseApp + '/api/turmas')).status, 503, 'rota de leitura de dados deve ficar bloqueada');
  assert.equal((await fetch(baseApp + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 503, 'toda mutação deve ficar bloqueada');

  const ultimaBaseAntiga = baseLegada('segunda-leitura-confirmada');
  ultimaBaseAntiga.ultimaGravacaoDaInstanciaAntiga = { preservada: true };
  estadoMain = JSON.parse(JSON.stringify(ultimaBaseAntiga));

  await esperar(async () => {
    const resposta = await fetch(baseApp + '/api/versao');
    const corpo = await resposta.json();
    return resposta.ok && !corpo.manutencaoMigracao && corpo.schemaVersion === 2 && corpo.backupPreMigracaoConfirmado === true;
  }, 'a migração não foi concluída\n' + log, 12000);

  assert.ok(leiturasMain >= 2, 'a linha main precisa ser relida depois do dreno');
  assert.equal(backups.size, 1, 'deve existir um único backup imutável');
  assert.deepEqual(Array.from(backups.values())[0], ultimaBaseAntiga, 'o backup deve ser a cópia exata da segunda leitura');
  assert.ok(mainSalvo, 'a migração precisa ser confirmada remotamente antes de liberar o sistema');
  assert.equal(mainSalvo.schemaVersion, 2);
  assert.deepEqual(mainSalvo.ultimaGravacaoDaInstanciaAntiga, { preservada: true }, 'a gravação tardia da instância antiga deve sobreviver');
  assert.equal(mainSalvo.migracaoSchema.backupConfirmado, true);

  const saidaPrimeiroApp = new Promise(resolve => app.once('exit', resolve));
  app.kill();
  await saidaPrimeiroApp;

  // Mesmo com o schema atual, todo novo processo no Render precisa drenar a
  // instância substituída e reler main. Não deve criar backup nem fazer um POST
  // de migração quando não há mudança de schema.
  const baseAtualPrimeira = JSON.parse(JSON.stringify(estadoMain));
  baseAtualPrimeira.marcadorBootAtual = 'primeira-leitura-schema-atual';
  baseAtualPrimeira.sessoes = {};
  estadoMain = baseAtualPrimeira;
  leiturasMain = 0;
  mainSalvo = null;
  const backupsAntes = backups.size;
  const upsertsAntes = upsertsMain;
  const portaAtual = await portaLivre();
  const urlAtual = `http://127.0.0.1:${portaAtual}`;
  const appAtual = iniciarApp({
    DATA_DIR: temp('laboratorio-gate-schema-atual-'),
    PORT: String(portaAtual),
    RENDER: 'true',
    SUPABASE_REQUIRED: 'true',
    SUPABASE_URL: `http://127.0.0.1:${supabase.address().port}`,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-teste',
    SUPABASE_STATE_TABLE: 'app_state',
    SUPABASE_STATE_ID: 'main',
    MIGRACAO_ROLLING_ESPERA_MS: '500'
  }, ['ignore', 'pipe', 'pipe']);
  let logAtual = '';
  appAtual.stdout.on('data', b => { logAtual += b; });
  appAtual.stderr.on('data', b => { logAtual += b; });

  await esperar(async () => {
    const resposta = await fetch(urlAtual + '/healthz');
    return resposta.ok && (await resposta.text()).includes('Atualização segura');
  }, 'boot com schema atual não abriu a janela de manutenção\n' + logAtual);
  assert.equal(leiturasMain, 1, 'schema atual também deve aguardar antes da segunda leitura no Render');
  assert.equal((await (await fetch(urlAtual + '/api/versao')).json()).manutencaoMigracao, true);

  const baseAtualSegunda = JSON.parse(JSON.stringify(baseAtualPrimeira));
  baseAtualSegunda.marcadorBootAtual = 'segunda-leitura-schema-atual';
  baseAtualSegunda.turmas['t-segunda-leitura'] = {
    id: 't-segunda-leitura',
    nome: 'Turma preservada na segunda leitura',
    professores: ['admin-gate'],
    criadaEm: Date.now()
  };
  estadoMain = baseAtualSegunda;

  await esperar(async () => {
    const resposta = await fetch(urlAtual + '/api/versao');
    const corpo = await resposta.json();
    return resposta.ok && !corpo.manutencaoMigracao && corpo.schemaVersion === 2;
  }, 'boot com schema atual não saiu da manutenção\n' + logAtual, 12000);

  assert.ok(leiturasMain >= 2, 'schema atual deve reler main depois do dreno');
  assert.equal(backups.size, backupsAntes, 'schema atual não pode criar outro backup de migração');
  assert.equal(upsertsMain, upsertsAntes, 'schema atual limpo não pode executar POST de migração');
  assert.equal(mainSalvo, null, 'o boot sem migração não deve regravar main');

  const loginAtual = await fetch(urlAtual + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usuario: 'admin-gate', senha: 'Admin-Gate-2026' })
  });
  assert.equal(loginAtual.status, 200, 'a base atual relida deve ser utilizável depois da janela');
  const cookieAtual = String(loginAtual.headers.get('set-cookie') || '').split(';')[0];
  const turmasAtuais = await (await fetch(urlAtual + '/api/turmas', { headers: { cookie: cookieAtual } })).json();
  assert.ok(turmasAtuais.turmas.some(t => t.id === 't-segunda-leitura'), 'dados da segunda leitura precisam ser os dados liberados ao tráfego');

  console.log('OK: Supabase obrigatório e todo rolling deploy no Render drenam, releem main e só migram schema antigo.');
}

executar().catch(e => { console.error(e.stack || e); process.exitCode = 1; }).finally(async () => {
  for (const processo of processos) if (processo.exitCode == null) processo.kill();
  for (const servidor of servidores) {
    try { if (servidor.closeAllConnections) servidor.closeAllConnections(); } catch {}
    try { await new Promise(resolve => servidor.close(resolve)); } catch {}
  }
  for (const dir of temporarios) fs.rmSync(dir, { recursive: true, force: true });
});
