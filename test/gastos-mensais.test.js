const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const appDir = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(appDir, 'server.js'), 'utf8');
const inicioFinanceiro = serverSource.indexOf('function numeroFinanceiroEnv');
const fimFinanceiro = serverSource.indexOf('// Registra o uso de IA', inicioFinanceiro);
assert.ok(inicioFinanceiro >= 0 && fimFinanceiro > inicioFinanceiro, 'bloco de preços deve existir');
const codigoFinanceiro = serverSource.slice(inicioFinanceiro, fimFinanceiro)
  + '\nthis.financeiro = { LICENCA_MENSAL_USD, RESERVA_IA_PERCENTUAL, PRECO_WEB_SEARCH_USD, precosDoModelo, custoUSD };';
const contextoFinanceiro = { process: { env: {} }, Date };
vm.runInNewContext(codigoFinanceiro, contextoFinanceiro);
const financeiro = contextoFinanceiro.financeiro;
assert.equal(financeiro.LICENCA_MENSAL_USD, 100);
assert.equal(financeiro.RESERVA_IA_PERCENTUAL, 25);
assert.equal(financeiro.PRECO_WEB_SEARCH_USD, 0.01);
assert.deepEqual(Array.from(financeiro.precosDoModelo('claude-opus-4-8')), [5, 25]);
assert.deepEqual(Array.from(financeiro.precosDoModelo('claude-sonnet-5', Date.parse('2026-08-31T12:00:00-03:00'))), [2, 10]);
assert.deepEqual(Array.from(financeiro.precosDoModelo('claude-sonnet-5', Date.parse('2026-09-01T00:00:00-03:00'))), [2, 10]);
assert.equal(financeiro.custoUSD('claude-opus-4-8', 1000000, 100000, 0, 0, 2), 7.52, 'Opus e buscas web devem usar os preços atuais');

const contextoConfigurado = { process: { env: { LICENCA_MENSAL_USD: '125,50', RESERVA_IA_PERCENTUAL: '30', PRECO_OPUS_4_8_ENTRADA_MTOK_USD: '6' } }, Date };
vm.runInNewContext(codigoFinanceiro, contextoConfigurado);
assert.equal(contextoConfigurado.financeiro.LICENCA_MENSAL_USD, 125.5);
assert.equal(contextoConfigurado.financeiro.RESERVA_IA_PERCENTUAL, 30);
assert.deepEqual(Array.from(contextoConfigurado.financeiro.precosDoModelo('claude-opus-4-8')), [6, 25]);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratorio-gastos-'));
const port = 37300 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
const salt = 'gastos-teste';
const senha = 'Admin-Gastos-2026';
const senhaHash = salt + ':' + crypto.scryptSync(senha, salt, 32).toString('hex');
const admin = {
  login: 'admin-gastos', senha: senhaHash, mudouSenha: true, nome: 'Administrador de teste', papel: 'Administrador',
  aceitePrivacidadeEm: Date.now(), versaoPrivacidade: '2026-08-batch-v1'
};
const mesUso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date());
const usoAtual = {
  nome: 'Administrador de teste', tipo: 'Administrador(a)', turma: '', chamadas: 1,
  entrada: 1000000, saida: 100000, cacheGravado: 0, cacheReutilizado: 0, buscasWeb: 2, usd: 7.52,
  porModelo: { 'claude-opus-4-8': { chamadas: 1, entrada: 1000000, saida: 100000, cacheGravado: 0, cacheReutilizado: 0, buscasWeb: 2, usd: 7.52 } },
  porOperacao: { 'teste-financeiro': { chamadas: 1, entrada: 1000000, saida: 100000, cacheGravado: 0, cacheReutilizado: 0, buscasWeb: 2, usd: 7.52 } }
};

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
  configuracaoFinanceiraMensal: {
    '2024-02': { licencaMensalUSD: 80, reservaIAPercentual: 10, orcamentoIAMensalUSD: 40, congeladaEm: Date.parse('2024-02-01T00:00:00Z') }
  },
  gastos: {
    '2024-01': {
      'prof:admin-gastos': { nome: 'Administrador de teste', tipo: 'Administrador(a)', turma: '', chamadas: 26, entrada: 300000, saida: 95869, usd: 1.49 }
    },
    [mesUso]: { 'prof:admin-gastos': usoAtual }
  }
}), 'utf8');

let app = null;
let log = '';
let chamadasPagas = 0;
const anthropic = http.createServer((req, res) => {
  chamadasPagas++;
  let corpo = '';
  req.on('data', parte => { corpo += parte; });
  req.on('end', () => {
    let pedido = {}; try { pedido = JSON.parse(corpo); } catch {}
    const model = pedido.model || 'claude-opus-4-8';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      content: [{ type: 'text', text: 'CASO:\nCaso simulado suficiente para o teste financeiro.\nGABARITO:\nResposta à acusação, com fundamentos e pedidos.' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 1000000,
        output_tokens: 100000,
        server_tool_use: { web_search_requests: 2 },
        metadata: { operacao: 'geracao-caso-teste', modelo: model }
      }
    }));
  });
});

async function ouvirMock() {
  await new Promise((resolve, reject) => {
    anthropic.once('error', reject);
    anthropic.listen(0, '127.0.0.1', resolve);
  });
  return anthropic.address().port;
}

async function executar() {
  const anthropicPort = await ouvirMock();
  app = spawn(process.execPath, ['server.js'], {
    cwd: appDir,
    env: Object.assign({}, process.env, {
      DATA_DIR: dataDir,
      PORT: String(port),
      PROF_LOGIN: 'admin-gastos',
      PROF_SENHA: senha,
      CRIAR_CONTAS_DEMO: 'false',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      ANTHROPIC_API_KEY: 'chave-de-teste',
      ANTHROPIC_API_URL: `http://127.0.0.1:${anthropicPort}/v1/messages`,
      MODELO_POTENTE: 'claude-opus-4-8',
      LICENCA_MENSAL_USD: '100',
      ORCAMENTO_IA_MENSAL_USD: '100',
      ORCAMENTO_IA_SEM_TETO: 'false',
      RESERVA_IA_PERCENTUAL: '25'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  app.stdout.on('data', b => { log += b; });
  app.stderr.on('data', b => { log += b; });

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

  r = await fetch(base + '/api/gerar-caso', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ peca: { nome: 'Resposta à acusação', ficha: {} }, nivel: 'BÁSICO' })
  });
  const corpoGeracao = await r.text();
  assert.equal(r.status, 410, 'a rota legada deve orientar o uso do fluxo atual: ' + corpoGeracao);
  assert.equal(JSON.parse(corpoGeracao).erro, 'ROTA_LEGADA_DESATIVADA');
  assert.equal(chamadasPagas, 0, 'a rota legada não pode consumir IA');

  r = await fetch(base + '/api/gastos', { headers: { cookie } });
  assert.equal(r.status, 200);
  const dados = await r.json();
  const registroLegado = dados.gastos['2024-01']['prof:admin-gastos'];
  assert.equal(registroLegado.custoAPI, 1.49);
  assert.equal(registroLegado.reservaIA, 0.37);
  assert.equal(registroLegado.usoIAComReserva, 1.86);
  assert.equal(registroLegado.valor, 1.86, 'valor permanece como alias compatível, sem multiplicador oculto');
  assert.deepEqual(dados.resumos['2024-01'], { custoAPI: 1.49, reservaIA: 0.37, usoIAComReserva: 1.86, licenca: 100, total: 101.86 });
  assert.ok(dados.meses.includes('2024-02'), 'competência de licença deve aparecer mesmo sem chamada de IA');
  assert.deepEqual(dados.resumos['2024-02'], { custoAPI: 0, reservaIA: 0, usoIAComReserva: 0, licenca: 80, total: 80 });
  assert.equal(dados.orcamentosIA['2024-02'].limiteUSD, 40, 'teto histórico deve usar o snapshot da competência');
  assert.equal(dados.configuracaoFinanceiraMensal['2024-02'].reservaIAPercentual, 10, 'mudança posterior de ambiente não pode recalcular a reserva histórica');
  assert.equal(dados.licencaMensal, 100);
  assert.equal(dados.reservaIAPercentual, 25);
  assert.equal(dados.precoWebSearchUSD, 0.01);

  const registroAtual = dados.gastos[mesUso]['prof:admin-gastos'];
  assert.equal(registroAtual.buscasWeb, 2);
  assert.equal(registroAtual.custoAPI, 7.52);
  assert.equal(registroAtual.reservaIA, 1.88);
  assert.equal(registroAtual.usoIAComReserva, 9.4);
  assert.ok(registroAtual.porModelo.some(x => x.nome === 'claude-opus-4-8' && x.custoAPI === 7.52));
  assert.ok(registroAtual.porOperacao.some(x => x.nome === 'teste-financeiro' && x.buscasWeb === 2));
  assert.deepEqual(dados.resumos[mesUso], { custoAPI: 7.52, reservaIA: 1.88, usoIAComReserva: 9.4, licenca: 100, total: 109.4 });
  assert.equal(dados.orcamentoIA.reservadoUSD, 0, 'a reserva deve ser liquidada ao receber o uso real');
  assert.equal(dados.orcamentoIA.disponivelParaNovasChamadasUSD, 92.48, 'o saldo deve considerar o custo real após a liquidação');
  assert.ok(dados.detalhamentos[mesUso].porModelo.some(x => x.nome === 'claude-opus-4-8'));
  assert.ok(dados.detalhamentos[mesUso].porOperacao.some(x => x.nome === 'teste-financeiro'));
  assert.ok(!Object.prototype.hasOwnProperty.call(dados, 'fator'), 'não pode existir multiplicador oculto');
  assert.ok(!Object.prototype.hasOwnProperty.call(dados, 'manutencaoMensal'), 'a licença não pode ser chamada de manutenção');
  assert.ok(!Object.prototype.hasOwnProperty.call(dados, 'creditoMensal'), 'a licença não pode aparecer como crédito');

  const html = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
  assert.match(html, /licença institucional/i);
  assert.match(html, /pagamento do autor/i);
  assert.match(html, /custo real da API/i);
  assert.match(html, /reserva operacional de IA/i);
  assert.doesNotMatch(html, /manutenção mensal/i);
  assert.doesNotMatch(serverSource, /multiplicadorInternoIA/);
  console.log('OK: licença institucional, reserva transparente, preços, buscas e detalhamento financeiro validados.');
}

executar().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (app) app.kill();
  await new Promise(resolve => anthropic.close(resolve));
});
