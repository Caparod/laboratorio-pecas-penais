const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const appDir = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-versao-'));
const port = 36500 + Math.floor(Math.random() * 800);
const base = `http://127.0.0.1:${port}`;
const versaoEsperada = 'teste-versao-2026';
const server = spawn(process.execPath, ['server.js'], {
  cwd: appDir,
  env: Object.assign({}, process.env, { DATA_DIR: dataDir, PORT: String(port), RENDER_GIT_COMMIT: versaoEsperada, CRIAR_CONTAS_DEMO: 'true', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }),
  stdio: ['ignore', 'pipe', 'pipe']
});

let log = '';
server.stdout.on('data', b => { log += b; });
server.stderr.on('data', b => { log += b; });

async function executar() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
    if (i === 79) throw new Error('Servidor não iniciou.\n' + log);
  }
  const pagina = await fetch(base);
  const html = await pagina.text();
  assert.equal(pagina.headers.get('cache-control'), 'no-store, must-revalidate');
  assert.ok(!html.includes('__APP_VERSION__'), 'o marcador interno de versão não pode chegar ao navegador');
  assert.ok(html.includes(`const APP_VERSION='${versaoEsperada}'`), 'a página deve receber a versão do deploy que a serviu');
  assert.ok(html.includes('Atualizar agora'), 'a página deve oferecer atualização sem interromper o usuário');

  const respostaVersao = await fetch(base + '/api/versao');
  assert.equal(respostaVersao.status, 200);
  assert.match(respostaVersao.headers.get('cache-control') || '', /no-store/);
  assert.deepEqual(await respostaVersao.json(), { ok: true, versao: versaoEsperada, schemaVersion: 2, backupPreMigracaoConfirmado: false });
  console.log('OK: detecção de nova versão e atualização segura validadas.');
}

executar().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => server.kill());
