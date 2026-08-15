'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
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
  for (let i = 0; i < 80; i++) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Servidor não iniciou.');
}

const relatorioValido = `## Acertos
- Identificou adequadamente a via processual e organizou a exposição de modo compreensível.
## Erros formais
- O fechamento formal pode ser aprimorado sem alterar o conteúdo jurídico desenvolvido.
## Erros materiais (direito)
- Uma das teses exige fundamentação legal mais completa segundo o espelho do professor.
## Pontuação item a item — espelho OAB/FGV adaptado ao Estágio (0 a 5)
| Item | Critério avaliado | Pontos obtidos/possíveis | Justificativa detalhada |
|---|---|---:|---|
| 1 | Cabimento e endereçamento | 1,00/1,00 | A peça e o órgão destinatário correspondem ao gabarito. |
| 2 | Tempestividade e legitimidade | 0,50/0,50 | O requisito foi atendido de forma suficiente. |
| 3 | Fatos e síntese | 0,50/0,50 | A síntese preserva a informação geográfica apresentada pelo aluno. |
| 4 | Fundamentação e teses | 1,00/1,50 | A tese principal foi apresentada, mas faltou aprofundar um fundamento legal. |
| 5 | Pedidos | 0,50/0,75 | O pedido principal está correto e o subsidiário ficou incompleto. |
| 6 | Técnica, linguagem e forma | 0,50/0,75 | A estrutura é compreensível, embora o fechamento formal exija ajuste. |
## Verificação de jurisprudência e citações
- Os dispositivos relevantes foram conferidos em fonte oficial e não há citação falsa identificada.
## Verificação de robotização e supervisão humana
- Risco: BAIXO. Não há elementos concretos suficientes para apontar produção automatizada sem revisão; a decisão permanece humana.
PENALIDADE POR ROBOTIZAÇÃO: 0,00
## Rastreabilidade dos descontos
| Falha identificada | Aplicação | Desconto |
|---|---|---:|
| Fundamentação incompleta | Item 4 do espelho | 0,50 |
| Pedido subsidiário incompleto | Item 5 do espelho | 0,25 |
| Fechamento formal | Item 6 do espelho | 0,25 |
PENALIDADE POR JURISPRUDÊNCIA NÃO CONFIRMADA: 0,00
PENALIDADE POR FORMATAÇÃO NPJ: 0,00
OUTRAS PENALIDADES FORA DO ESPELHO: 0,00
TOTAL DE PENALIDADES FORA DO ESPELHO: 0,00
NOTA SUGERIDA: 4,00/5
## Propostas de aprimoramento
- Aprofundar a tese indicada no espelho, relacionando o dispositivo legal aos fatos, e conferir a completude dos pedidos e do fechamento antes da entrega definitiva.
## Fontes e links
- [Código de Processo Penal](https://www.planalto.gov.br/ccivil_03/decreto-lei/del3689compilado.htm)`;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recurso-ia-reparo-'));
  const senha = 'Professor-Recurso-2026';
  const professor = { login: 'admin', senha: hashSenha(senha, 'sal-prof'), mudouSenha: true, nome: 'Professor', papel: 'Administrador', aceitePrivacidadeEm: Date.now(), versaoPrivacidade: '2026-08' };
  const caso = casoTeste(); const gab = gabaritoTeste('Apelação Criminal');
  const textoAluno = 'A defesa apresentou a síntese dos fatos e registrou expressamente a localização correta na Via Hélio Prates, além de desenvolver fundamentos, pedidos e fechamento em texto acadêmico próprio, suficientemente extenso para a avaliação individualizada.';
  const db = {
    turmaAtiva: 'Turma 1', professor, professores: { admin: professor },
    turmas: { t1: { id: 't1', nome: 'Turma 1', professores: ['admin'], criadaEm: Date.now() } }, proximaTurma: 2,
    alunos: { '9900001': { nome: 'Aluno', senha: hashSenha('Aluno-2026', 'sal-aluno'), mudouSenha: true, email: 'aluno@example.test', emailVerificado: true, turmaId: 't1', turmaIds: ['t1'] } },
    pecas: { p2: { id: 'p2', num: 2, rodada: 2, nomePeca: 'Apelação Criminal', disc: 'Turma 1', turmaId: 't1', caso, gab, publicada: true, autor: 'admin', versao: 1, historico: [] } }, proximoNum: 3,
    entregas: { p2: { '9900001': { nome: 'Aluno', texto: textoAluno, enviadoEm: Date.now(), validado: true, nota: 3.15, relatorio: relatorioValido, snapshotPeca: { versao: 1, nomePeca: 'Apelação Criminal', disc: 'Turma 1', caso, gab }, recurso: { status: 'pendente', motivo: 'O espelho afirma que indiquei local incorreto, mas a peça registra claramente a Via Hélio Prates. Solicito a conferência desse item e da pontuação correspondente.', criadoEm: Date.now(), notaRecorrida: 3.15, relatorioRecorrido: relatorioValido } } } },
    sessoes: {}, gastos: {}
  };
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(db));

  const requisicoesIA = [];
  const ia = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', b => { corpo += b; });
    req.on('end', () => {
      const pedido = JSON.parse(corpo); requisicoesIA.push(pedido);
      const primeiraResposta = `## Síntese objetiva do recurso\nO aluno contesta a leitura do local indicado.\n## Análise de cada ponto contestado\nA informação deve ser novamente confrontada com a entrega.\n## Conferência do espelho e da pontuação\nHá fundamento para revisar o item.\nRESULTADO RECOMENDADO: DEFERIDO PARCIALMENTE\n## Impacto sugerido na nota\nRecalcular apenas o item afetado.\n## Fundamentação sugerida ao professor\nO recurso merece acolhimento parcial porque a informação consta da entrega.\n## Fontes oficiais consultadas\n- CPP no Planalto.\n## Espelho revisado proposto\n## Acertos\n- A localização foi indicada corretamente.\n## Pontuação item a item\n| Item | Pontos obtidos/possíveis |\n|---|---:|\n| Fatos | 0,50/0,50 |`;
      const texto = requisicoesIA.length === 1 ? primeiraResposta : relatorioValido;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg-teste', type: 'message', role: 'assistant', model: pedido.model, stop_reason: 'end_turn', content: [{ type: 'text', text: texto }], usage: { input_tokens: 100, output_tokens: 200 } }));
    });
  });
  await new Promise(resolve => ia.listen(0, '127.0.0.1', resolve));
  const port = await portaLivre();
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { DATA_DIR: dir, PORT: String(port), PROF_LOGIN: 'admin', PROF_SENHA: senha, CRIAR_CONTAS_DEMO: 'false', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', ANTHROPIC_API_KEY: 'teste', ANTHROPIC_API_URL: 'http://127.0.0.1:' + ia.address().port + '/v1/messages', MODELO_POTENTE: 'modelo-potente-teste', MODELO_REPARO: 'claude-sonnet-5' }), stdio: ['ignore', 'pipe', 'pipe'] });
  const base = 'http://127.0.0.1:' + port;
  async function post(rota, body, cookie) { const headers = { 'content-type': 'application/json' }; if (cookie) headers.cookie = cookie; const r = await fetch(base + rota, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, body: await r.json(), cookie: String(r.headers.get('set-cookie') || '').split(';')[0] }; }
  try {
    await esperar(base + '/api/versao');
    const login = await post('/api/login', { usuario: 'admin', senha });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    const resposta = await post('/api/recurso/analisar-ia', { id: 'p2', matricula: '9900001' }, login.cookie);
    assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
    assert.equal(resposta.body.resultadoSugerido, 'Deferido parcialmente');
    assert.equal(resposta.body.notaSugerida, 4);
    assert.equal(requisicoesIA.length, 2, 'deve haver uma análise e um reparo estrutural');
    assert.equal(requisicoesIA[1].model, 'claude-sonnet-5', 'o reparo deve usar o modelo específico e econômico');
    assert.equal(requisicoesIA[1].tools, undefined, 'o reparo estrutural não deve refazer pesquisas jurídicas');
    assert.match(JSON.stringify(requisicoesIA[1].messages), /relatorio_revisado_alta_capacidade/);
    assert.match(JSON.stringify(requisicoesIA[1].messages), /falhas_estruturais/);
    const salvo = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')).entregas.p2['9900001'].recurso.sugestaoIA;
    assert.equal(salvo.resultado, 'Deferido parcialmente'); assert.equal(salvo.nota, 4);
    console.log('OK: recurso preserva o mérito e repara separadamente um espelho inconsistente.');
  } finally {
    child.kill(); ia.close(); fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
