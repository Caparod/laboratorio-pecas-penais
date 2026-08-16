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
function zipUmaEntrada(nome, conteudo) {
  const n = Buffer.from(nome), d = Buffer.from(conteudo);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 8); local.writeUInt32LE(d.length, 18); local.writeUInt32LE(d.length, 22); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 10); central.writeUInt32LE(d.length, 20); central.writeUInt32LE(d.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(0, 42);
  const trecho = Buffer.concat([local, n, d]);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(central.length + n.length, 12); eocd.writeUInt32LE(trecho.length, 16);
  return Buffer.concat([trecho, central, n, eocd]);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entrega-professor-'));
  const agora = Date.now();
  const db = {
    turmaAtiva: 'Turma 1',
    professor: { login: 'admin', senha: hashSenha('Admin-Entrega-2026', 'sal-admin'), mudouSenha: true, nome: 'Administrador', papel: 'Administrador', aceitePrivacidadeEm: agora, versaoPrivacidade: '2026-08' },
    professores: {},
    turmas: { t1: { id: 't1', nome: 'Turma 1', professores: ['admin'], criadaEm: agora }, t2: { id: 't2', nome: 'Turma 2', professores: ['admin'], criadaEm: agora } },
    proximaTurma: 3,
    alunos: {
      '9900010': { nome: 'Aluno da Rodada', senha: hashSenha('Aluno-Entrega-2026', 'sal-a1'), mudouSenha: true, email: 'a1@example.test', emailVerificado: true, whatsapp: '+5561999999991', turmaId: 't1', turmaIds: ['t1'] },
      '9900020': { nome: 'Aluno de Outra Turma', senha: hashSenha('Aluno-Outra-2026', 'sal-a2'), mudouSenha: true, email: 'a2@example.test', emailVerificado: true, whatsapp: '+5561999999992', turmaId: 't2', turmaIds: ['t2'] }
    },
    pecas: { p2: { id: 'p2', num: 2, rodada: 2, nomePeca: 'Apelação Criminal', disc: 'Turma 1', turmaId: 't1', caso: casoTeste(), gab: gabaritoTeste('Apelação Criminal'), prazo: '2000-01-01T00:00', publicada: true, autor: 'admin', versao: 1, historico: [], parecerInicialPorAluno: { '9900010': agora - 1000 } } },
    proximoNum: 3,
    entregas: { p2: {} }, sessoes: {}, gastos: {}
  };
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(db));
  const port = await portaLivre();
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { DATA_DIR: dir, PORT: String(port), PROF_LOGIN: 'admin', PROF_SENHA: 'Admin-Entrega-2026', CRIAR_CONTAS_DEMO: 'false', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '' }), stdio: ['ignore', 'pipe', 'pipe'] });
  const base = 'http://127.0.0.1:' + port;
  async function post(rota, body, cookie) { const h = { 'content-type': 'application/json' }; if (cookie) h.cookie = cookie; const r = await fetch(base + rota, { method: 'POST', headers: h, body: JSON.stringify(body) }); return { status: r.status, body: await r.json(), cookie: String(r.headers.get('set-cookie') || '').split(';')[0] }; }
  try {
    await esperar(base + '/api/versao');
    const login = await post('/api/login', { usuario: 'admin', senha: 'Admin-Entrega-2026' });
    assert.equal(login.status, 200, JSON.stringify(login.body));

    const texto = 'EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO. O aluno apresenta recurso de apelação com fatos, fundamentos jurídicos, aplicação concreta, pedidos e fechamento formal suficientes para ser corrigido.';
    const xml = '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>' + texto + '</w:t></w:r></w:p></w:body></w:document>';
    const docx = zipUmaEntrada('word/document.xml', xml);
    const importacao = await post('/api/aluno/extrair-arquivo', { nome: 'peca-recebida.docx', arquivo: 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,' + docx.toString('base64') }, login.cookie);
    assert.equal(importacao.status, 200, JSON.stringify(importacao.body));
    assert.match(importacao.body.texto, /recurso de apelação/);

    const registro = await post('/api/entrega/registrar-professor', { id: 'p2', matricula: '9900010', texto: importacao.body.texto, arquivo: importacao.body.arquivo }, login.cookie);
    assert.equal(registro.status, 200, JSON.stringify(registro.body));
    assert.equal(registro.body.status, 'A corrigir');

    const lista = await fetch(base + '/api/pecas', { headers: { cookie: login.cookie } });
    const proposta = (await lista.json()).pecas.find(p => p.id === 'p2');
    assert.equal(proposta.turmaId, 't1', 'a rodada deve informar a turma para filtrar os alunos no formulário');
    assert.equal(proposta.aCorrigir.length, 1, 'a entrega registrada pelo professor deve entrar imediatamente em A corrigir');
    assert.equal(proposta.aCorrigir[0].matricula, '9900010');

    const disco = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    const entrega = disco.entregas.p2['9900010'];
    assert.equal(entrega.origemProfessor, 'admin');
    assert.equal(entrega.registradaPeloProfessor.motivo, 'arquivo-recebido-fora-do-sistema');
    assert.equal(entrega.validado, undefined, 'a entrega deve permanecer pendente de correção');
    assert.ok(disco.pecas.p2.parecerInicialPorAluno['9900010'], 'o registro pelo professor não deve consumir nem apagar a pré-correção existente');

    const duplicada = await post('/api/entrega/registrar-professor', { id: 'p2', matricula: '9900010', texto: importacao.body.texto, arquivo: importacao.body.arquivo }, login.cookie);
    assert.equal(duplicada.status, 409, 'uma entrega existente nunca deve ser sobrescrita silenciosamente');
    const outraTurma = await post('/api/entrega/registrar-professor', { id: 'p2', matricula: '9900020', texto: importacao.body.texto, arquivo: importacao.body.arquivo }, login.cookie);
    assert.equal(outraTurma.status, 403, 'o servidor deve impedir associação entre aluno e rodada de turmas diferentes');

    const loginAluno = await post('/api/login', { usuario: '9900020', senha: 'Aluno-Outra-2026' });
    const alunoTentando = await post('/api/entrega/registrar-professor', { id: 'p2', matricula: '9900020', texto: importacao.body.texto, arquivo: importacao.body.arquivo }, loginAluno.cookie);
    assert.equal(alunoTentando.status, 403, 'a rota de registro em nome de aluno deve ser exclusiva do professor');
    console.log('OK: professor registra arquivo em nome do aluno, sem sobrescrever entregas nem misturar turmas.');
  } finally { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
