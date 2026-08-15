const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const appDir = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-gastos-'));
const port = 37300 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
const salt = 'gastos-teste';
const senha = 'Admin-Gastos-2026';
const senhaHash = salt + ':' + crypto.scryptSync(senha, salt, 32).toString('hex');
const admin = { login: 'admin-gastos', senha: senhaHash, mudouSenha: true, nome: 'Administrador de teste', papel: 'Administrador' };

fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
  turmaAtiva: 'Estágio I',
  alunos: {},
  professor: admin,
  professores: { 'admin-gastos': admin },
  pecas: {},
  proximoNum: 1,
  entregas: {},
  sessoes: {},
  turmas: { t1: { id: 't1', nome: 'Turma teste', professores: ['admin-gastos'], criadaEm: Date.now() } },
  proximaTurma: 2,
  gastos: {
    '2024-01': {
      'prof:admin-gastos': { nome: 'Administrador de teste', tipo: 'Administrador(a)', turma: '', chamadas: 26, entrada: 300000, saida: 95869, usd: 1.49 }
    }
  }
}), 'utf8');

const server = spawn(process.execPath, ['server.js'], {
  cwd: appDir,
  env: Object.assign({}, process.env, { DATA_DIR: dataDir, PORT: String(port), PROF_LOGIN: 'admin-gastos', PROF_SENHA: senha, CRIAR_CONTAS_DEMO: 'false', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }),
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
  let r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuario: 'admin-gastos', senha }) });
  assert.equal(r.status, 200);
  const cookie = String(r.headers.get('set-cookie') || '').split(';')[0];
  const login = await r.json();
  assert.ok(cookie.startsWith('lab_session='), 'login web deve autenticar por cookie');
  assert.ok(!Object.prototype.hasOwnProperty.call(login, 'token'), 'produção não deve expor o token de sessão ao JavaScript');
  r = await fetch(base + '/api/gastos', { headers: { cookie } });
  assert.equal(r.status, 200);
  const dados = await r.json();
  const registro = dados.gastos['2024-01']['prof:admin-gastos'];
  assert.equal(registro.valor, 2.98, 'o valor consolidado de IA deve aplicar a regra interna');
  assert.deepEqual(dados.resumos['2024-01'], { manutencao: 100, usoIA: 2.98, total: 102.98 });
  assert.equal(dados.manutencaoMensal, 100);
  assert.ok(!Object.prototype.hasOwnProperty.call(dados, 'fator'), 'o multiplicador interno não pode ser exposto');
  assert.ok(!Object.prototype.hasOwnProperty.call(dados, 'creditoMensal'), 'manutenção não pode aparecer como crédito');
  assert.ok(!Object.prototype.hasOwnProperty.call(registro, 'custoApi'), 'o custo bruto não pode ser exposto');

  const html = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
  assert.match(html, /manutenção mensal/i);
  assert.ok(!/Fator configurado|crédito do mês|saldo disponível/i.test(html), 'a interface não pode revelar a regra interna nem tratar manutenção como crédito');
  console.log('OK: manutenção mensal e gastos consolidados de IA validados.');
}

executar().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => server.kill());
