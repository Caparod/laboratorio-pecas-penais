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
assert.match(servidorFonte, /const MODELO_PRECORRECAO = process\.env\.MODELO_PRECORRECAO \|\| 'claude-sonnet-5'/, 'pré-correção deve usar Sonnet por padrão');
assert.match(servidorFonte, /const MODELO_OCR = process\.env\.MODELO_OCR \|\| 'claude-haiku-4-5-20251001'/, 'OCR deve usar Haiku 4.5 por padrão');
assert.match(servidorFonte, /const MODELO_GABARITO =[\s\S]*'claude-opus-4-8'/, 'gabarito deve preservar Opus 4.8 por padrão');
assert.match(servidorFonte, /function exigeBuscaOficial[\s\S]*detectarJurisprudencia\(texto\)[\s\S]*https\?/m, 'busca deve depender de jurisprudência ou URL detectada');
assert.match(servidorFonte, /PARECER_EM_ANDAMENTO/, 'solicitação concorrente deve informar que a pré-correção está em andamento');
assert.doesNotMatch(servidorFonte, /motivoContingencia[^\n]*solicitacao-simultanea/, 'concorrência não pode gravar uma contingência sobre o resultado em andamento');
assert.match(servidorFonte, /function precorrecaoRegistrada[\s\S]{0,300}resultado[\s\S]{0,200}parecer\.trim\(\)/, 'marcador legado isolado não pode satisfazer a pré-correção obrigatória');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-precorrecao-'));
const appPort = 39200 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${appPort}`;

function hashSenha(senha, salt) {
  return salt + ':' + crypto.scryptSync(senha, salt, 32).toString('hex');
}

const professor = { login: 'admin-precorrecao', senha: hashSenha('Admin-Precorrecao-2026', 'sal-prof'), mudouSenha: true, nome: 'Administrador', papel: 'Administrador', aceitePrivacidadeEm: Date.now(), versaoPrivacidade: '2026-08-batch-v1' };
const aluno = { nome: 'Aluno de teste', senha: hashSenha('Aluno-Precorrecao-2026', 'sal-aluno'), mudouSenha: true, email: 'aluno@example.test', whatsapp: '+5561999999999', emailVerificado: true, cadastroCompletoEm: Date.now(), aceitePrivacidadeEm: Date.now(), versaoPrivacidade: '2026-08-batch-v1', turmaId: 't1', turmaIds: ['t1'], usos: {} };
const alunoFallback = { ...aluno, nome: 'Aluno fallback', senha: hashSenha('Aluno-Fallback-2026', 'sal-fallback'), email: 'fallback@example.test' };
const alunoJuris = { ...aluno, nome: 'Aluno jurisprudência', senha: hashSenha('Aluno-Juris-2026', 'sal-juris'), email: 'juris@example.test' };
const alunoSemChave = { ...aluno, nome: 'Aluno contingência', senha: hashSenha('Aluno-Sem-Chave-2026', 'sal-sem-chave'), email: 'sem-chave@example.test' };
const alunoLegado = { ...aluno, nome: 'Aluno marcador legado', senha: hashSenha('Aluno-Legado-2026', 'sal-legado'), email: 'legado@example.test' };
const alunoConcorrente = { ...aluno, nome: 'Aluno concorrente', senha: hashSenha('Aluno-Concorrente-2026', 'sal-concorrente'), email: 'concorrente@example.test' };
const alunoAmbiguo = { ...aluno, nome: 'Aluno falha ambígua', senha: hashSenha('Aluno-Ambiguo-2026', 'sal-ambiguo'), email: 'ambiguo@example.test' };

fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
  turmaAtiva: 'Turma de teste', alunos: { '9900001': aluno, '9900002': alunoFallback, '9900003': alunoJuris, '9900004': alunoSemChave, '9900005': alunoLegado, '9900006': alunoConcorrente, '9900007': alunoAmbiguo }, professor,
  professores: { 'admin-precorrecao': professor },
  turmas: { t1: { id: 't1', nome: 'Turma de teste', professores: ['admin-precorrecao'], criadaEm: Date.now() } }, proximaTurma: 2,
  pecas: { p1: { id: 'p1', num: 1, rodada: 1, nomePeca: 'Manifestação processual', disc: 'Turma de teste', turmaId: 't1', caso: casoTeste(), gab: gabaritoTeste('Manifestação processual'), prazo: '2099-12-31T23:59', criadaEm: Date.now(), publicada: true, autor: 'admin-precorrecao', versao: 1, historico: [], parecerInicialPorAluno: { '9900005': Date.now() - 10000 } } },
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
  chamadasIA++; const pedido = JSON.parse(corpo); pedidosIA.push(pedido);
  const pedidoComJurisprudencia = /Súmula 123 do STJ/.test(JSON.stringify(pedido.messages));
  const pedidoConcorrente = /CONCORRENCIA_SEGURA/.test(JSON.stringify(pedido.messages));
  const pedidoAmbiguo = /FALHA_FINANCEIRA_AMBIGUA/.test(JSON.stringify(pedido.messages));
  const textoResposta = chamadasIA === 1 || pedidoComJurisprudencia || pedidoConcorrente ? parecerTeste : `## Leitura inicial
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
  const responder = () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_teste', type: 'message', role: 'assistant', model: 'modelo-teste', stop_reason: 'end_turn', content: [{ type: 'text', text: textoResposta }], usage: { input_tokens: 100, output_tokens: 200 } }));
  };
  if (pedidoAmbiguo) res.destroy(); else if (pedidoConcorrente) setTimeout(responder, 200); else responder();
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
  const iniciarServidor = chave => {
    app = spawn(process.execPath, ['server.js'], {
      cwd: appDir,
      env: Object.assign({}, process.env, { DATA_DIR: dataDir, PORT: String(appPort), PROF_LOGIN: 'admin-precorrecao', PROF_SENHA: 'Admin-Precorrecao-2026', CRIAR_CONTAS_DEMO: 'false', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', ANTHROPIC_API_KEY: chave, ANTHROPIC_API_URL: `http://127.0.0.1:${iaPort}/v1/messages` }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    app.stdout.on('data', b => { log += b; }); app.stderr.on('data', b => { log += b; });
  };
  iniciarServidor('chave-de-teste');
  await aguardarServidor();

  const login = await post('/api/login', '', { usuario: '9900001', senha: 'Aluno-Precorrecao-2026' });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.ok(!Object.prototype.hasOwnProperty.call(login.body, 'token'), 'produção não deve expor token ao JavaScript');
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie.startsWith('lab_session='));

  const texto = 'Texto acadêmico de teste suficientemente longo para acionar a pré-correção e verificar a recuperação idempotente do parecer sem incluir qualquer dado pessoal real.';
  const loginLegado = await post('/api/login', '', { usuario: '9900005', senha: 'Aluno-Legado-2026' });
  assert.equal(loginLegado.status, 200, JSON.stringify(loginLegado.body));
  const cookieLegado = String(loginLegado.headers.get('set-cookie') || '').split(';')[0];
  const painelLegado = await get('/api/pecas-aluno', cookieLegado);
  assert.equal(painelLegado.body.pecas[0].parecerInicialUsado, false, 'marcador legado sem parecer não pode liberar envio direto');
  const envioLegado = await post('/api/entregar', cookieLegado, { id: 'p1', texto });
  assert.equal(envioLegado.status, 409);
  assert.equal(envioLegado.body.erro, 'PRECORRECAO_OBRIGATORIA');
  const bloqueioSemParecer = await post('/api/entregar', cookie, { id: 'p1', texto });
  assert.equal(bloqueioSemParecer.status, 409, JSON.stringify(bloqueioSemParecer.body));
  assert.equal(bloqueioSemParecer.body.erro, 'PRECORRECAO_OBRIGATORIA', 'o backend deve impedir envio que contorne a interface');
  assert.match(bloqueioSemParecer.body.mensagem, /pré-correção obrigatória/i);
  const primeira = await post('/api/aluno/parecer-inicial', cookie, { id: 'p1', texto });
  assert.equal(primeira.status, 200, JSON.stringify(primeira.body));
  assert.equal(primeira.body.reutilizado, false); assert.equal(primeira.body.parecer, parecerTeste);
  assert.equal(primeira.body.modelo, 'modelo-teste', 'deve registrar o modelo real devolvido pela API, não apenas o solicitado');
  assert.equal(primeira.body.contingencia, false);
  assert.equal(pedidosIA[0].model, 'claude-sonnet-5', 'a primeira pré-correção deve usar Sonnet');
  assert.ok(!pedidosIA[0].tools, 'texto sem jurisprudência ou URL não deve acionar busca web');
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
  assert.equal(respostaFallback.body.contingencia, true, 'parecer determinístico deve declarar o modo de contingência');
  assert.equal(respostaFallback.body.modelo, 'deterministico-local');
  assert.match(respostaFallback.body.aviso, /contingência/i);
  assert.ok(respostaFallback.body.pdfBase64.length > 1000, 'o parecer seguro também deve ser entregue em PDF');
  assert.equal(chamadasIA, 4, 'uma resposta insegura deve receber reparo Sonnet, escalonamento Opus e então cair no roteiro seguro');
  assert.equal(pedidosIA[1].model, 'claude-sonnet-5', 'tentativa principal deve usar Sonnet');
  assert.equal(pedidosIA[2].model, 'claude-sonnet-5', 'reparo deve permanecer no Sonnet');
  assert.equal(pedidosIA[3].model, 'claude-opus-4-8', 'falha persistente do validador deve escalar para Opus');
  const contextoReparo = JSON.stringify(pedidosIA[2].messages);
  assert.match(contextoReparo, /<resposta_estudante>/, 'o reparo deve receber novamente a resposta do aluno para continuar individualizado');
  assert.match(contextoReparo, /<enunciado>/, 'o reparo deve receber novamente o enunciado');
  assert.match(JSON.stringify(pedidosIA[3].messages), /<falhas_das_tentativas_anteriores>/, 'o escalonamento deve receber as falhas objetivas do validador');
  assert.match(respostaFallback.body.parecer, /"Texto acadêmico de teste suficientemente longo/, 'até o fallback deve analisar trecho literal da resposta');

  let bancoIntermediario = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.equal(bancoIntermediario.pecas.p1.parecerInicialResultados['9900002'].contingencia, true, 'a contingência deve ser persistida e recuperável');
  assert.equal(bancoIntermediario.pecas.p1.parecerInicialResultados['9900002'].modelo, 'deterministico-local');

  const loginJuris = await post('/api/login', '', { usuario: '9900003', senha: 'Aluno-Juris-2026' });
  assert.equal(loginJuris.status, 200, JSON.stringify(loginJuris.body));
  const cookieJuris = String(loginJuris.headers.get('set-cookie') || '').split(';')[0];
  const respostaJuris = await post('/api/aluno/parecer-inicial', cookieJuris, { id: 'p1', texto: texto + ' O estudante citou a Súmula 123 do STJ e deverá conferir seu teor em fonte oficial.' });
  assert.equal(respostaJuris.status, 200, JSON.stringify(respostaJuris.body));
  assert.equal(respostaJuris.body.contingencia, false);
  assert.equal(chamadasIA, 5);
  assert.ok(Array.isArray(pedidosIA[4].tools) && pedidosIA[4].tools.some(t => t.name === 'web_search'), 'jurisprudência detectada deve habilitar busca oficial');

  const loginConcorrente = await post('/api/login', '', { usuario: '9900006', senha: 'Aluno-Concorrente-2026' });
  assert.equal(loginConcorrente.status, 200, JSON.stringify(loginConcorrente.body));
  const cookieConcorrente = String(loginConcorrente.headers.get('set-cookie') || '').split(';')[0];
  const textoConcorrente = texto + ' CONCORRENCIA_SEGURA deve manter uma única geração em andamento sem sobrescrita.';
  const primeiraConcorrente = post('/api/aluno/parecer-inicial', cookieConcorrente, { id: 'p1', texto: textoConcorrente });
  await new Promise(resolve => setTimeout(resolve, 50));
  const segundaConcorrente = await post('/api/aluno/parecer-inicial', cookieConcorrente, { id: 'p1', texto: textoConcorrente });
  assert.equal(segundaConcorrente.status, 409, JSON.stringify(segundaConcorrente.body));
  assert.equal(segundaConcorrente.body.erro, 'PARECER_EM_ANDAMENTO');
  const resultadoConcorrente = await primeiraConcorrente;
  assert.equal(resultadoConcorrente.status, 200, JSON.stringify(resultadoConcorrente.body));
  assert.equal(resultadoConcorrente.body.contingencia, false, 'requisição concorrente não pode sobrescrever o resultado válido com contingência');
  assert.equal(chamadasIA, 6, 'somente a geração original deve chegar ao provedor');

  const loginAmbiguo = await post('/api/login', '', { usuario: '9900007', senha: 'Aluno-Ambiguo-2026' });
  assert.equal(loginAmbiguo.status, 200, JSON.stringify(loginAmbiguo.body));
  const cookieAmbiguo = String(loginAmbiguo.headers.get('set-cookie') || '').split(';')[0];
  const respostaAmbigua = await post('/api/aluno/parecer-inicial', cookieAmbiguo, { id: 'p1', texto: texto + ' FALHA_FINANCEIRA_AMBIGUA exige compromisso conservador e reconciliação.' });
  assert.equal(respostaAmbigua.status, 200, JSON.stringify(respostaAmbigua.body));
  assert.equal(respostaAmbigua.body.contingencia, true);
  assert.equal(chamadasIA, 7, 'falha ambígua não deve ser repetida nem liberar a mesma reserva silenciosamente');
  const loginAdminFinanceiro = await post('/api/login', '', { usuario: 'admin-precorrecao', senha: 'Admin-Precorrecao-2026' });
  assert.equal(loginAdminFinanceiro.status, 200, JSON.stringify(loginAdminFinanceiro.body));
  const cookieAdminFinanceiro = String(loginAdminFinanceiro.headers.get('set-cookie') || '').split(';')[0];
  const gastosComPendencia = await get('/api/gastos', cookieAdminFinanceiro);
  assert.equal(gastosComPendencia.status, 200, JSON.stringify(gastosComPendencia.body));
  assert.equal(gastosComPendencia.body.pendenciasFinanceirasIA.length, 1, 'falha ambígua deve manter reserva persistente visível à administração');
  assert.ok(gastosComPendencia.body.orcamentoIA.reservadoUSD > 0, 'compromisso incerto deve continuar consumindo o teto');
  const pendencia = gastosComPendencia.body.pendenciasFinanceirasIA[0];
  const reconciliada = await post('/api/gastos/reconciliar-pendencia', cookieAdminFinanceiro, { id: pendencia.id, resultadoConsole: 'nao-cobrada', motivo: 'Conferido no Console: a chamada não foi aceita nem cobrada.', confirmacao: 'RECONCILIAR CHAMADA' });
  assert.equal(reconciliada.status, 200, JSON.stringify(reconciliada.body));
  const gastosReconciliados = await get('/api/gastos', cookieAdminFinanceiro);
  assert.equal(gastosReconciliados.body.pendenciasFinanceirasIA.length, 0, 'reserva só deve ser liberada após reconciliação administrativa explícita');

  const envioFallback = await post('/api/entregar', cookieFallback, { id: 'p1', texto: texto + ' Versão definitiva enviada apenas para testar a reabertura.' });
  assert.equal(envioFallback.status, 200, JSON.stringify(envioFallback.body));
  assert.equal(envioFallback.body.reenvio, false);
  const reenvioFallback = await post('/api/entregar', cookieFallback, { id: 'p1', texto: texto + ' Versão revisada e reenviada depois da mesma pré-correção obrigatória já registrada.' });
  assert.equal(reenvioFallback.status, 200, JSON.stringify(reenvioFallback.body));
  assert.equal(reenvioFallback.body.reenvio, true, 'uma pré-correção já registrada deve continuar autorizando reenvios revisados');
  const bancoReenvio = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  const entregaReenviada = bancoReenvio.entregas.p1['9900002'];
  assert.match(entregaReenviada.snapshotPecaRef || '', /^[a-f0-9]{64}$/, 'envio do aluno deve guardar referência canônica');
  assert.ok(!Object.prototype.hasOwnProperty.call(entregaReenviada, 'snapshotPeca'), 'envio do aluno não deve repetir caso e gabarito');
  assert.equal(Object.keys(bancoReenvio.pecas.p1.snapshots || {}).length, 1, 'reenvio da mesma versão deve reutilizar a fotografia existente');
  assert.equal(bancoReenvio.pecas.p1.snapshots[entregaReenviada.snapshotPecaRef].caso, bancoReenvio.pecas.p1.caso);
  assert.equal(bancoReenvio.pecas.p1.snapshots[entregaReenviada.snapshotPecaRef].gab, bancoReenvio.pecas.p1.gab);
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

  await new Promise(resolve => {
    const anterior = app; let encerrou = false;
    const concluir = () => { if (!encerrou) { encerrou = true; resolve(); } };
    anterior.once('exit', concluir); anterior.kill(); setTimeout(concluir, 2000);
  });
  app = null;
  iniciarServidor('');
  await aguardarServidor();
  const loginSemChave = await post('/api/login', '', { usuario: '9900004', senha: 'Aluno-Sem-Chave-2026' });
  assert.equal(loginSemChave.status, 200, JSON.stringify(loginSemChave.body));
  const cookieSemChave = String(loginSemChave.headers.get('set-cookie') || '').split(';')[0];
  const semChave = await post('/api/aluno/parecer-inicial', cookieSemChave, { id: 'p1', texto: texto + ' A indisponibilidade externa não pode impedir o roteiro pedagógico.' });
  assert.equal(semChave.status, 200, JSON.stringify(semChave.body) + '\n' + log);
  assert.equal(semChave.body.contingencia, true, 'ausência de chave deve cair no parecer local sem bloquear');
  assert.equal(semChave.body.modelo, 'deterministico-local');
  assert.equal(chamadasIA, 7, 'modo sem chave não deve tentar chamar a API');
  const semChaveRecuperado = await post('/api/aluno/parecer-inicial', cookieSemChave, { id: 'p1', texto: texto + ' A indisponibilidade externa não pode impedir o roteiro pedagógico.' });
  assert.equal(semChaveRecuperado.status, 200);
  assert.equal(semChaveRecuperado.body.reutilizado, true, 'contingência deve ser recuperável sem nova geração');
  const bancoSemChave = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.equal(bancoSemChave.pecas.p1.parecerInicialResultados['9900004'].motivoContingencia, 'sem-chave-configurada');
  const legadoRegenerado = await post('/api/aluno/parecer-inicial', cookieLegado, { id: 'p1', texto: texto + ' O marcador antigo precisa ser substituído por um parecer real.' });
  assert.equal(legadoRegenerado.status, 200, JSON.stringify(legadoRegenerado.body));
  assert.equal(legadoRegenerado.body.contingencia, true);
  const bancoLegado = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.ok(bancoLegado.pecas.p1.parecerInicialResultados['9900005'].parecer, 'marcador legado deve ser substituído por parecer persistido');
  console.log('OK: pré-correção realista, privada, recuperável e com fallback pedagógico seguro.');
}

executar().catch(e => { console.error(e.stack || e); process.exitCode = 1; }).finally(() => {
  if (app) app.kill(); ia.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
});
