const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const appDir = path.resolve(__dirname, '..');
const dirs = [];

function temp(prefix) { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); dirs.push(d); return d; }
function aguardarSaida(child, ms = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Servidor não encerrou após falha de persistência.')); }, ms);
    child.once('exit', code => { clearTimeout(timer); resolve(code); });
  });
}

async function executar() {
  let posts = 0;
  const supabase = http.createServer((req, res) => {
    if (req.method === 'POST') posts++;
    res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"erro":"falha simulada"}');
  });
  await new Promise(resolve => supabase.listen(0, '127.0.0.1', resolve));
  const portaSupabase = supabase.address().port;
  const dataFalhaRemota = temp('laboratorio-supabase-falha-');
  const appRemota = spawn(process.execPath, ['server.js'], {
    cwd: appDir,
    env: Object.assign({}, process.env, { DATA_DIR: dataFalhaRemota, PORT: '0', PROF_LOGIN: 'admin-persistencia', PROF_SENHA: 'Senha-Persistencia-2026', SUPABASE_URL: `http://127.0.0.1:${portaSupabase}`, SUPABASE_SERVICE_ROLE_KEY: 'chave-teste' }),
    stdio: 'ignore'
  });
  const codigoRemoto = await aguardarSaida(appRemota);
  assert.notEqual(codigoRemoto, 0, 'falha ao carregar Supabase deve impedir a inicialização');
  assert.equal(posts, 0, 'falha de leitura remota nunca pode provocar sobrescrita por POST');
  assert.ok(!fs.existsSync(path.join(dataFalhaRemota, 'db.json')), 'fallback local não deve ser gravado após falha remota');
  await new Promise(resolve => supabase.close(resolve));

  const dataCorrompida = temp('laboratorio-db-corrompida-');
  const dbPath = path.join(dataCorrompida, 'db.json');
  fs.writeFileSync(dbPath, '{arquivo-invalido');
  const appCorrompida = spawn(process.execPath, ['server.js'], {
    cwd: appDir,
    env: Object.assign({}, process.env, { DATA_DIR: dataCorrompida, PORT: '0', PROF_LOGIN: 'admin-persistencia', PROF_SENHA: 'Senha-Persistencia-2026', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }),
    stdio: 'ignore'
  });
  const codigoLocal = await aguardarSaida(appCorrompida);
  assert.notEqual(codigoLocal, 0, 'base local corrompida deve impedir a inicialização');
  assert.equal(fs.readFileSync(dbPath, 'utf8'), '{arquivo-invalido', 'base corrompida deve ser preservada para recuperação');
  assert.ok(!fs.existsSync(dbPath + '.bak'), 'falha de leitura não deve sobrescrever o backup');

  console.log('OK: falhas de persistência são seguras e não sobrescrevem dados.');
}

executar().catch(e => { console.error(e.stack || e); process.exitCode = 1; }).finally(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
