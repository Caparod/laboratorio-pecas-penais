'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { casoTeste, gabaritoTeste } = require('./fixture-peca');

const appDir = path.resolve(__dirname, '..');
const servidorFonte = fs.readFileSync(path.join(appDir, 'server.js'), 'utf8');
assert.match(servidorFonte, /## Profundidade argumentativa[\s\S]*fato relevante, fundamento jurídico, aplicação ao caso e consequência ou pedido/, 'a pré-correção deve alertar deterministicamente sobre tópicos defensivos superficiais');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-precorrecao-'));
const appPort = 39200 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${appPort}`;

function hashSenha(senha, salt) {
  return salt + ':' + crypto.scryptSync(senha, salt, 32).toString('hex');
}

const professor = { login: 'admin-precorrecao', senha: hashSenha('Admin-Precorrecao-2026', 'sal-prof'), mudouSenha: true, nome: 'Administrador', papel: 'Administrador', aceitePrivacidadeEm: Date.now(), versaoPrivacidade: '2026-08' };
const aluno = { nome: 'Aluno de teste', senha: hashSenha('Aluno-Precorrecao-2026', 'sal-aluno'), mudouSenha: true, email: 'aluno@example.test', whatsapp: '+5561999999999', emailVerificado: true, cadastroCompletoEm: Date.now(), aceitePrivacidadeEm: Date.now(), versaoPrivacidade: '2026-08', turmaId: 't1', turmaIds: ['t1'], usos: {} };
const alunoFallback = { ...aluno, nome: 'Aluno fallback', senha: hashSenha('Aluno-Fallback-2026', 'sal-fallback'), email: 'fallback@example.test' };

fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
  turmaAtiva: 'Turma de teste', alunos: { '9900001': aluno, '9900002': alunoFallback }, professor,
  professores: { 'admin-precorrecao': professor },
  turmas: { t1: { id: 't1', nome: 'Turma de teste', professores: ['admin-precorrecao'], criadaEm: Date.now() } }, proximaTurma: 2,
  pecas: { p1: { id: 'p1', num: 1, rodada: 1, nomePeca: 'Manifestação processual', disc: 'Turma de teste', turmaId: 't1', caso: casoTeste(), gab: gabaritoTeste('Manifestação processual'), prazo: '2099-12-31T23:59', criadaEm: Date.now(), publicada: true, autor: 'admin-precorrecao', versao: 1, historico: [] } },
  proximoNum: 2, entregas: { p1: {} }, sessoes: {}, gastos: {}
}), 'utf8');

const parecerTeste = `## Leitura inicial
- O trecho "Texto acadêmico de teste suficientemente longo" permite identificar a abertura da resposta. Confira se ele reproduz com fidelidade os sujeitos, fatos e datas do enunciado.
- A organização é reconhecível, mas cada conclusão deve estar ligada a um fundamento desenvolvido no texto.
## Referências e citações
- Confira individualmente as referências usadas em fontes oficiais e retire afirmações que não possam ser confirmadas.
## Integridade do arquivo
- Não foram observados marcadores residuais ou instruções estranhas no conteúdo analisado.
## Formatação NPJ
- Confira papel timbrado, fonte, margens, espaçamento, alinhamento, recuo e paginação conforme o material oficial. Somente desconformidades objetivamente verificadas podem reduzir a avaliação final.
## Pontos de atenção
- Trecho observado → confira a fidelidade aos fatos → todos os elementos aparecem no enunciado?
- Fundamentos → confira a aplicação concreta → cada referência foi relacionada ao caso?
- Pedidos → confira a coerência → todos decorrem do que foi desenvolvido?
## Próximo passo
1. Compare a resposta com o enunciado.
2. Confira cada referência em fonte oficial.
3. Releia a sequência entre fundamentos e pedidos antes de decidir pelo envio.`;

let chamadasIA = 0;
const pedidosIA = [];
const ia = http.createServer((req, res) => {
  let corpo = ''; req.on('data', b => { corpo += b; }); req.on('end', () => {
  chamadasIA++; pedidosIA.push(JSON.parse(corpo));
  const textoResposta = chamadasIA === 1 ? parecerTeste : `## Leitura inicial
A peça correta é Apelação Criminal e deve usar o art. 593 do CPP.
## Referências e citações
Use o artigo indicado e peça o provimento para absolvição.
## Integridade do arquivo
O gabarito confirma a solução.
## Formatação NPJ
Nota sugerida: 5/5.
## Pontos de atenção
Apresente a tese de absolvição.
## Próximo passo
Copie a resposta-modelo.`;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id: 'msg_teste', type: 'message', role: 'assistant', model: 'modelo-teste', stop_reason: 'end_turn', content: [{ type: 'text', text: textoResposta }], usage: { input_tokens: 100, output_tokens: 200 } }));
  });
});

let app;
let log = '';

async function aguardarServidor() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Servidor não iniciou.\n' + log);
}

async function post(url, cookie, body) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const r = await fetch(base + url, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json(), headers: r.headers };
}
async function get(url, cookie) {
  const r = await fetch(base + url, { headers: cookie ? { cookie } : {} });
  return { status: r.status, body: await r.json(), headers: r.headers };
}

async function executar() {
  await new Promise(resolve => ia.listen(0, '127.0.0.1', resolve));
  const iaPort = ia.address().port;
  app = spawn(process.execPath, ['server.js'], {
    cwd: appDir,
    env: Object.assign({}, process.env, { DATA_DIR: dataDir, PORT: String(appPort), PROF_LOGIN: 'admin-precorrecao', PROF_SENHA: 'Admin-Precorrecao-2026', CRIAR_CONTAS_DEMO: 'false', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', ANTHROPIC_API_KEY: 'chave-de-teste', ANTHROPIC_API_URL: `http://127.0.0.1:${iaPort}/v1/messages` }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  app.stdout.on('data', b => { log += b; }); app.stderr.on('data', b => { log += b; });
  await aguardarServidor();

  const login = await post('/api/login', '', { usuario: '9900001', senha: 'Aluno-Precorrecao-2026' });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.ok(!Object.prototype.hasOwnProperty.call(login.body, 'token'), 'produção não deve expor token ao JavaScript');
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie.startsWith('lab_session='));

  const texto = 'Texto acadêmico de teste suficientemente longo para acionar a pré-correção e verificar a recuperação idempotente do parecer sem incluir qualquer dado pessoal real.';
  const primeira = await post('/api/aluno/parecer-inicial', cookie, { id: 'p1', texto });
  assert.equal(primeira.status, 200, JSON.stringify(primeira.body));
  assert.equal(primeira.body.reutilizado, false); assert.equal(primeira.body.parecer, parecerTeste);
  assert.ok(primeira.body.pdfBase64.length > 1000, 'primeira resposta deve conter o PDF do parecer');

  const segunda = await post('/api/aluno/parecer-inicial', cookie, { id: 'p1', texto });
  assert.equal(segunda.status, 200, JSON.stringify(segunda.body));
  assert.equal(segunda.body.reutilizado, true, 'repetição deve recuperar o resultado anterior');
  assert.equal(segunda.body.parecer, primeira.body.parecer); assert.equal(segunda.body.pdfBase64, primeira.body.pdfBase64);
  assert.equal(chamadasIA, 1, 'recuperação não pode chamar nem cobrar a IA novamente');

  const loginFallback = await post('/api/login', '', { usuario: '9900002', senha: 'Aluno-Fallback-2026' });
  assert.equal(loginFallback.status, 200, JSON.stringify(loginFallback.body));
  const cookieFallback = String(loginFallback.headers.get('set-cookie') || '').split(';')[0];
  const respostaFallback = await post('/api/aluno/parecer-inicial', cookieFallback, { id: 'p1', texto: texto + ' Este caso força a proteção pedagógica automática.' });
  assert.equal(respostaFallback.status, 200, JSON.stringify(respostaFallback.body) + '\n' + log);
  assert.match(respostaFallback.body.parecer, /## Leitura inicial/);
  assert.doesNotMatch(respostaFallback.body.parecer, /Apelação Criminal|resposta-modelo|\bnota\b|5\/5/i);
  assert.ok(respostaFallback.body.pdfBase64.length > 1000, 'o parecer seguro também deve ser entregue em PDF');
  assert.equal(chamadasIA, 3, 'uma resposta insegura deve ser reparada uma vez e cair no roteiro seguro sem erro ao aluno');
  const contextoReparo = JSON.stringify(pedidosIA[2].messages);
  assert.match(contextoReparo, /<resposta_estudante>/, 'o reparo deve receber novamente a resposta do aluno para continuar individualizado');
  assert.match(contextoReparo, /<enunciado>/, 'o reparo deve receber novamente o enunciado');
  assert.match(respostaFallback.body.parecer, /"Texto acadêmico de teste suficientemente longo/, 'até o fallback deve analisar trecho literal da resposta');

  const envioFallback = await post('/api/entregar', cookieFallback, { id: 'p1', texto: texto + ' Versão definitiva enviada apenas para testar a reabertura.' });
  assert.equal(envioFallback.status, 200, JSON.stringify(envioFallback.body));
  const loginProfessor = await post('/api/login', '', { usuario: 'admin-precorrecao', senha: 'Admin-Precorrecao-2026' });
  assert.equal(loginProfessor.status, 200, JSON.stringify(loginProfessor.body));
  const cookieProfessor = String(loginProfessor.headers.get('set-cookie') || '').split(';')[0];
  const removida = await post('/api/peca/precorrecao/liberar', cookieProfessor, { id: 'p1', matricula: '9900002', desconsiderarEntrega: true });
  assert.equal(removida.status, 200, JSON.stringify(removida.body));
  assert.equal(removida.body.novaPreCorrecaoLiberada, true);
  assert.equal(removida.body.entregaDesconsiderada, true);
  const painelAluno = await get('/api/pecas-aluno', cookieFallback);
  assert.equal(painelAluno.status, 200); assert.equal(painelAluno.body.pecas[0].parecerInicialUsado, false);

  const banco = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  const registro = banco.pecas.p1.parecerInicialResultados['9900001'];
  assert.equal(registro.parecer, parecerTeste); assert.ok(/^[a-f0-9]{64}$/.test(registro.textoSha256));
  assert.ok(!Object.prototype.hasOwnProperty.call(registro, 'pdfBase64'), 'o banco não deve ser inflado com o PDF regenerável');
  assert.ok(!banco.entregas.p1['9900002'], 'a entrega desconsiderada deve ser removida');
  assert.ok(!banco.pecas.p1.parecerInicialPorAluno['9900002'], 'o uso anterior da pré-correção deve ser liberado');
  console.log('OK: pré-correção realista, privada, recuperável e com fallback pedagógico seguro.');
}

executar().catch(e => { console.error(e.stack || e); process.exitCode = 1; }).finally(() => {
  if (app) app.kill(); ia.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
});
