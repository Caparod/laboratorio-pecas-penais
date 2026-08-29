'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');
const { casoTeste, gabaritoTeste } = require('./fixture-peca');

const appDir = path.resolve(__dirname, '..');
const fonte = fs.readFileSync(path.join(appDir, 'server.js'), 'utf8');

// Exercita as faixas sem depender de arredondamento da resposta HTTP.
const inicio = fonte.indexOf('function numeroFinanceiroEnv');
const fim = fonte.indexOf('function acumularDetalheGasto', inicio);
assert.ok(inicio >= 0 && fim > inicio, 'bloco de orçamento deve existir');
const codigo = fonte.slice(inicio, fim) + '\nthis.api = { ORCAMENTO_IA_MENSAL_USD, estadoOrcamentoIA, bloqueioOrcamentoIA, estimarReservaChamadaIA, reservarOrcamentoChamadaIA, liberarReservaOrcamentoIA, totalReservadoOrcamentoIA, reservasOrcamentoIA };';
function carregarFinanceiro(env, usd) {
  const mes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date());
  const contexto = { process: { env: Object.assign({ ORCAMENTO_IA_SEM_TETO: 'false' }, env || {}) }, Date, Intl, Buffer, crypto, MODELO_CORRECAO: 'claude-sonnet-5', db: { gastos: { [mes]: { sistema: { usd } } } } };
  vm.runInNewContext(codigo, contexto);
  return contexto.api;
}

assert.equal(carregarFinanceiro({}, 0).ORCAMENTO_IA_MENSAL_USD, 100, 'orçamento padrão deve ser US$100');
assert.equal(carregarFinanceiro({ CREDITO_MENSAL_USD: '75' }, 0).ORCAMENTO_IA_MENSAL_USD, 75, 'nome legado deve continuar aceito');
assert.equal(carregarFinanceiro({ CREDITO_MENSAL_USD: '75', ORCAMENTO_IA_MENSAL_USD: '120' }, 0).ORCAMENTO_IA_MENSAL_USD, 120, 'variável nova deve prevalecer');
assert.equal(carregarFinanceiro({}, 69.99).estadoOrcamentoIA().nivel, 'normal');
assert.equal(carregarFinanceiro({}, 70).estadoOrcamentoIA().nivel, 'atencao');
assert.equal(carregarFinanceiro({}, 85).estadoOrcamentoIA().nivel, 'critico');
assert.equal(carregarFinanceiro({}, 85).bloqueioOrcamentoIA(), null, '85% deve alertar, sem corte antecipado');
assert.equal(carregarFinanceiro({}, 100).estadoOrcamentoIA().nivel, 'esgotado');
assert.equal(carregarFinanceiro({}, 100).bloqueioOrcamentoIA().codigo, 'ORCAMENTO_IA_MENSAL_ATINGIDO');
assert.equal(carregarFinanceiro({ ORCAMENTO_IA_SEM_TETO: 'true' }, 1000).bloqueioOrcamentoIA(), null, 'modo sem teto deve manter o registro sem bloquear novas chamadas');
assert.equal(carregarFinanceiro({ ORCAMENTO_IA_SEM_TETO: 'true' }, 1000).estadoOrcamentoIA().semTeto, true);

// Duas chamadas simultâneas mantêm suas reservas pendentes no mesmo saldo.
// A terceira é recusada antes de sair do processo, sem ultrapassar o teto.
const concorrente = carregarFinanceiro({ ORCAMENTO_IA_MENSAL_USD: '0.25' }, 0.02);
const corpoConcorrente = { model: 'claude-sonnet-5', max_tokens: 10000, system: 'teste', messages: [{ role: 'user', content: 'teste concorrente' }] };
const reservaUm = concorrente.reservarOrcamentoChamadaIA(corpoConcorrente, { operacao: 'concorrente-1' });
const reservaDois = concorrente.reservarOrcamentoChamadaIA(corpoConcorrente, { operacao: 'concorrente-2' });
assert.equal(reservaUm.ok, true);
assert.equal(reservaDois.ok, true);
const estadoConcorrente = concorrente.estadoOrcamentoIA();
assert.ok(estadoConcorrente.consumidoUSD + estadoConcorrente.reservadoUSD <= estadoConcorrente.limiteUSD + 0.000001, 'consumo e reservas simultâneas devem permanecer dentro do teto');
assert.equal(estadoConcorrente.reservadoUSD, Math.round((reservaUm.estimadoUSD + reservaDois.estimadoUSD) * 1e6) / 1e6);
assert.equal(estadoConcorrente.disponivelParaNovasChamadasUSD, Math.round((0.25 - 0.02 - reservaUm.estimadoUSD - reservaDois.estimadoUSD) * 1e6) / 1e6);
concorrente.reservasOrcamentoIA.get(reservaUm.id).mes = '2000-01';
assert.equal(concorrente.estadoOrcamentoIA().reservadoUSD, Math.round((reservaUm.estimadoUSD + reservaDois.estimadoUSD) * 1e6) / 1e6, 'reserva ativa iniciada antes da virada deve acompanhar a competência atual');
const terceiraConcorrente = concorrente.reservarOrcamentoChamadaIA(corpoConcorrente, { operacao: 'concorrente-3' });
assert.equal(terceiraConcorrente.ok, false, 'uma nova chamada deve ser bloqueada enquanto as duas reservas estão em aberto');
assert.equal(terceiraConcorrente.codigo, 'ORCAMENTO_IA_MENSAL_ATINGIDO');
concorrente.liberarReservaOrcamentoIA(reservaUm.id);
concorrente.liberarReservaOrcamentoIA(reservaDois.id);
assert.equal(concorrente.estadoOrcamentoIA().reservadoUSD, 0, 'reservas devem poder ser liberadas após erro ou timeout');

const semEspaco = carregarFinanceiro({ ORCAMENTO_IA_MENSAL_USD: '0.10' }, 0);
const grandeDemais = semEspaco.reservarOrcamentoChamadaIA({ model: 'claude-sonnet-5', max_tokens: 20000, system: 'teste', messages: [{ role: 'user', content: 'x' }] }, { operacao: 'estimativa-sem-saldo' });
assert.equal(grandeDemais.ok, false, 'a chamada não deve começar quando sua estimativa máxima não cabe no saldo');
assert.equal(semEspaco.estadoOrcamentoIA().reservadoUSD, 0, 'uma reserva recusada não deve consumir saldo');

for (const linha of fonte.split(/\r?\n/).filter(l => /\biaTexto\(/.test(l) && !/async function iaTexto/.test(l))) {
  assert.match(linha, /operacao\s*:/, 'toda chamada iaTexto deve informar a operação: ' + linha.trim());
}
assert.match(fonte, /liquidarReservaOrcamentoIA\(reserva\.id, cfg\.sess, modeloReal, d\.usage, \{ operacao, modelo: modeloReal \}\)/, 'cada reserva deve ser liquidada com modelo e operação reais no livro-razão');
assert.match(fonte, /catch \(e\) \{\s*await comprometerReservaChamadaIncerta\(reserva\.id,[\s\S]{0,120}throw e;/, 'timeout ou falha de rede não pode liberar silenciosamente a reserva');
assert.match(fonte, /status: 'resultado-incerto'[\s\S]{0,1200}requerReconciliacaoManual: true/, 'resultado ambíguo deve virar compromisso financeiro persistente');
assert.match(fonte, /\/api\/gastos\/reconciliar-pendencia/, 'administração deve ter reconciliação explícita da chamada incerta');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-orcamento-'));
const port = 40100 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
const mesAtual = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date());
function hashSenha(senha, salt) { return salt + ':' + crypto.scryptSync(senha, salt, 32).toString('hex'); }

const professor = { login: 'admin-orcamento', senha: hashSenha('Admin-Orcamento-2026', 'sal-prof'), mudouSenha: true, nome: 'Administrador', papel: 'Administrador', aceitePrivacidadeEm: Date.now(), versaoPrivacidade: '2026-08-batch-v1' };
const aluno = { nome: 'Aluno orçamento', senha: hashSenha('Aluno-Orcamento-2026', 'sal-aluno'), mudouSenha: true, email: 'orcamento@example.test', whatsapp: '+5561999999999', emailVerificado: true, cadastroCompletoEm: Date.now(), aceitePrivacidadeEm: Date.now(), versaoPrivacidade: '2026-08-batch-v1', turmaId: 't1', turmaIds: ['t1'], usos: {} };
fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
  turmaAtiva: 'Turma orçamento', alunos: { '9910001': aluno }, professor,
  professores: { 'admin-orcamento': professor },
  turmas: { t1: { id: 't1', nome: 'Turma orçamento', professores: ['admin-orcamento'], criadaEm: Date.now() } }, proximaTurma: 2,
  pecas: { p1: { id: 'p1', num: 1, rodada: 1, nomePeca: 'Manifestação processual', disc: 'Turma orçamento', turmaId: 't1', caso: casoTeste(), gab: gabaritoTeste('Manifestação processual'), prazo: '2099-12-31T23:59', criadaEm: Date.now(), publicada: true, autor: 'admin-orcamento', versao: 1, historico: [] } },
  proximoNum: 2, entregas: { p1: {} }, sessoes: {},
  gastos: { [mesAtual]: { sistema: { nome: 'Sistema', tipo: 'Sistema', chamadas: 1, entrada: 1, saida: 1, usd: 100 } } }
}), 'utf8');

let chamadasPagas = 0;
const ia = http.createServer((req, res) => {
  chamadasPagas++;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ model: 'modelo-mock', stop_reason: 'end_turn', content: [{ type: 'text', text: 'não deveria ser chamado' }], usage: { input_tokens: 1, output_tokens: 1 } }));
});
let app = null;
let log = '';

async function post(rota, cookie, body) {
  const r = await fetch(base + rota, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json(), cookie: String(r.headers.get('set-cookie') || '').split(';')[0] };
}

async function executar() {
  await new Promise((resolve, reject) => { ia.once('error', reject); ia.listen(0, '127.0.0.1', resolve); });
  app = spawn(process.execPath, ['server.js'], {
    cwd: appDir,
    env: Object.assign({}, process.env, {
      DATA_DIR: dataDir, PORT: String(port), PROF_LOGIN: 'admin-orcamento', PROF_SENHA: 'Admin-Orcamento-2026',
      CRIAR_CONTAS_DEMO: 'false', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', ANTHROPIC_API_KEY: 'chave-teste',
      ANTHROPIC_API_URL: `http://127.0.0.1:${ia.address().port}/v1/messages`, ORCAMENTO_IA_MENSAL_USD: '100', ORCAMENTO_IA_SEM_TETO: 'false', LICENCA_MENSAL_USD: '100'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  app.stdout.on('data', b => { log += b; }); app.stderr.on('data', b => { log += b; });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
    if (i === 99) throw new Error('Servidor não iniciou.\n' + log);
  }

  const loginProf = await post('/api/login', '', { usuario: 'admin-orcamento', senha: 'Admin-Orcamento-2026' });
  assert.equal(loginProf.status, 200);
  const gastosResposta = await fetch(base + '/api/gastos', { headers: { cookie: loginProf.cookie } });
  const gastos = await gastosResposta.json();
  assert.equal(gastosResposta.status, 200);
  assert.equal(gastos.orcamentoIAMensal, 100);
  assert.deepEqual(gastos.alertasOrcamentoIAPercentual, [70, 85, 100]);
  assert.equal(gastos.orcamentoIA.consumidoUSD, 100);
  assert.equal(gastos.orcamentoIA.nivel, 'esgotado');
  assert.equal(gastos.orcamentoIA.alertas.setenta, true);
  assert.equal(gastos.orcamentoIA.alertas.oitentaECinco, true);
  assert.equal(gastos.orcamentoIA.alertas.cem, true);
  assert.equal(gastos.orcamentoIA.incluiLicencaInstitucional, false);
  assert.equal(gastos.licencaMensal, 100, 'licença deve continuar separada do teto bruto');

  const bloqueada = await post('/api/peca/gerar-ia', loginProf.cookie, { nomePeca: 'Resposta à Acusação', disc: 'Estágio I', nivel: 'BÁSICO' });
  assert.equal(bloqueada.status, 402, JSON.stringify(bloqueada.body));
  assert.equal(bloqueada.body.erro, 'ORCAMENTO_IA_MENSAL_ATINGIDO');
  assert.equal(chamadasPagas, 0, 'operação não essencial não deve chamar a API após o teto');

  const rotaLegadaBloqueada = await post('/api/gerar-caso', loginProf.cookie, { peca: { nome: 'Resposta à Acusação', ficha: {} }, nivel: 'BÁSICO' });
  assert.equal(rotaLegadaBloqueada.status, 410, JSON.stringify(rotaLegadaBloqueada.body));
  assert.equal(rotaLegadaBloqueada.body.erro, 'ROTA_LEGADA_DESATIVADA');
  assert.match(rotaLegadaBloqueada.body.mensagem, /fluxo atual/i);
  assert.equal(chamadasPagas, 0, 'a rota legada desativada não deve gerar gasto');

  const loginAluno = await post('/api/login', '', { usuario: '9910001', senha: 'Aluno-Orcamento-2026' });
  assert.equal(loginAluno.status, 200);
  const texto = 'Texto acadêmico suficientemente longo para solicitar a pré-correção obrigatória mesmo quando o orçamento mensal da API já estiver totalmente consumido.';
  const parecer = await post('/api/aluno/parecer-inicial', loginAluno.cookie, { id: 'p1', texto });
  assert.equal(parecer.status, 200, JSON.stringify(parecer.body) + '\n' + log);
  assert.equal(parecer.body.contingencia, true);
  assert.equal(parecer.body.modelo, 'deterministico-local');
  assert.match(parecer.body.aviso, /contingência/i);
  assert.equal(chamadasPagas, 0, 'pré-correção deve usar contingência sem chamada paga');
  const banco = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  const persistida = banco.pecas.p1.parecerInicialResultados['9910001'];
  assert.equal(persistida.contingencia, true);
  assert.equal(persistida.motivoContingencia, 'orcamento-ia-mensal-atingido');
  console.log('OK: teto bruto mensal, alertas e pré-correção de contingência validados.');
}

executar().catch(e => { console.error(e.stack || e); process.exitCode = 1; }).finally(async () => {
  if (app) app.kill();
  await new Promise(resolve => ia.close(resolve));
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
});
