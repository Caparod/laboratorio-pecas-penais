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
async function portaLivre() { const net = require('net'); return new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); }); s.on('error', reject); }); }
async function esperar(url) { for (let i = 0; i < 80; i++) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); } throw new Error('Servidor não iniciou.'); }

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recurso-decisao-'));
  const senhaProfessor = 'Professor-Recurso-2026';
  const professor = { login: 'admin', senha: hashSenha(senhaProfessor, 'sal-prof'), mudouSenha: true, nome: 'Professor', papel: 'Administrador', emailAviso: 'professor@example.test', aceitePrivacidadeEm: Date.now(), versaoPrivacidade: '2026-08' };
  const caso = casoTeste() + '\nDurante o trajeto, na Via Hélio Prates, ocorreu o fato narrado.'; const gab = gabaritoTeste('Apelação Criminal');
  const casoSnapshotDesatualizado = casoTeste() + '\nDurante o trajeto, na via L2 Norte, ocorreu o fato narrado.';
  const textoAluno = 'A defesa apresentou a síntese dos fatos e registrou expressamente a localização correta na Via Hélio Prates, além de desenvolver fundamentos, pedidos e fechamento em texto acadêmico próprio, suficientemente extenso para a avaliação individualizada.';
  const entrega = (nome, nota) => ({ nome, texto: textoAluno, enviadoEm: Date.now(), validado: true, nota, relatorio: relatorioValido, snapshotPeca: { versao: 1, nomePeca: 'Apelação Criminal', disc: 'Turma 1', caso: casoSnapshotDesatualizado, gab } });
  const primeira = entrega('Aluno Recurso', 3.15);
  primeira.recurso = { status: 'pendente', motivo: 'O espelho afirma que indiquei local incorreto, mas a peça registra claramente a Via Hélio Prates. Solicito a conferência desse item e da pontuação correspondente.', criadoEm: Date.now(), notaRecorrida: 3.15, relatorioRecorrido: relatorioValido };
  const db = {
    turmaAtiva: 'Turma 1', professor, professores: { admin: professor },
    turmas: { t1: { id: 't1', nome: 'Turma 1', professores: ['admin'], criadaEm: Date.now() } }, proximaTurma: 2,
    alunos: {
      '9900001': { nome: 'Aluno Recurso', senha: hashSenha('Aluno-Um-2026', 'sal-a1'), mudouSenha: true, email: 'a1@example.test', emailVerificado: true, whatsapp: '+5561999999991', cadastroCompletoEm: Date.now(), turmaId: 't1', turmaIds: ['t1'] },
      '9900002': { nome: 'Aluno Aviso', senha: hashSenha('Aluno-Dois-2026', 'sal-a2'), mudouSenha: true, email: 'a2@example.test', emailVerificado: true, whatsapp: '+5561999999992', cadastroCompletoEm: Date.now(), turmaId: 't1', turmaIds: ['t1'] }
    },
    pecas: { p2: { id: 'p2', num: 2, rodada: 2, nomePeca: 'Apelação Criminal', disc: 'Turma 1', turmaId: 't1', caso, gab, publicada: true, autor: 'admin', versao: 1, historico: [] } }, proximoNum: 3,
    entregas: { p2: { '9900001': primeira, '9900002': entrega('Aluno Aviso', 3.5) } }, sessoes: {}, gastos: {}, avisosProfessores: []
  };
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(db));

  const requisicoesIA = [];
  const ia = http.createServer((req, res) => {
    let corpo = ''; req.on('data', b => { corpo += b; }); req.on('end', () => {
      const pedido = JSON.parse(corpo); requisicoesIA.push(pedido);
      const texto = `**RESULTADO RECOMENDADO:** ACEITO PARCIALMENTE
**NOVA NOTA:** 3,50/5
**JUSTIFICATIVA AO ALUNO:** O recurso foi aceito parcialmente porque a informação sobre a Via Hélio Prates consta expressamente da peça entregue, afastando o desconto factual contestado.
**TRECHO DO ENUNCIADO:** Durante o trajeto, na Via Hélio Prates, ocorreu o fato narrado.
## Análise técnica para o professor
A entrega confirma o ponto factual indicado pelo aluno; os demais critérios permanecem inalterados.
## Fontes oficiais consultadas
- [CPP](https://www.planalto.gov.br/ccivil_03/decreto-lei/del3689compilado.htm)`;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg-teste', type: 'message', role: 'assistant', model: pedido.model, stop_reason: 'end_turn', content: [{ type: 'text', text: texto }], usage: { input_tokens: 100, output_tokens: 120 } }));
    });
  });
  await new Promise(resolve => ia.listen(0, '127.0.0.1', resolve));
  const port = await portaLivre();
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { DATA_DIR: dir, PORT: String(port), PROF_LOGIN: 'admin', PROF_SENHA: senhaProfessor, CRIAR_CONTAS_DEMO: 'false', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '', ANTHROPIC_API_KEY: 'teste', ANTHROPIC_API_URL: 'http://127.0.0.1:' + ia.address().port + '/v1/messages', MODELO_POTENTE: 'modelo-potente-teste' }), stdio: ['ignore', 'pipe', 'pipe'] });
  const base = 'http://127.0.0.1:' + port;
  async function post(rota, body, cookie) { const headers = { 'content-type': 'application/json' }; if (cookie) headers.cookie = cookie; const r = await fetch(base + rota, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, body: await r.json(), cookie: String(r.headers.get('set-cookie') || '').split(';')[0] }; }
  async function get(rota, cookie) { const r = await fetch(base + rota, { headers: { cookie } }); return { status: r.status, body: await r.json() }; }
  try {
    await esperar(base + '/api/versao');
    const loginProfessor = await post('/api/login', { usuario: 'admin', senha: senhaProfessor });
    assert.equal(loginProfessor.status, 200, JSON.stringify(loginProfessor.body));

    const analise = await post('/api/recurso/analisar-ia', { id: 'p2', matricula: '9900001' }, loginProfessor.cookie);
    assert.equal(analise.status, 200, JSON.stringify(analise.body));
    assert.equal(analise.body.resultadoSugerido, 'Aceito parcialmente'); assert.equal(analise.body.notaSugerida, 3.5);
    assert.ok(!Object.prototype.hasOwnProperty.call(analise.body, 'relatorio'), 'o recurso não deve gerar novo espelho');
    assert.equal(requisicoesIA.length, 1, 'rótulos em negrito não podem provocar falsa resposta incompleta nem nova cobrança');
    const contextoIA = JSON.stringify(requisicoesIA[0].messages);
    assert.match(contextoIA, /<enunciado_atual_autoritativo>/, 'a análise do recurso deve identificar o enunciado atual como fonte autoritativa');
    assert.match(contextoIA, /Via Hélio Prates/, 'a análise deve receber o enunciado atual publicado');
    assert.doesNotMatch(contextoIA, /via L2 Norte/, 'um snapshot desatualizado não pode substituir o enunciado atual publicado');

    const confirmacao = await post('/api/entrega/validar', { id: 'p2', matricula: '9900001', validar: true, relatorio: 'tentativa de substituir o espelho', nota: 3.5, resultadoRecurso: 'Aceito parcialmente', decisaoRecurso: analise.body.decisaoSugerida }, loginProfessor.cookie);
    assert.equal(confirmacao.status, 200, JSON.stringify(confirmacao.body)); assert.equal(confirmacao.body.recursoDecidido, true); assert.equal(confirmacao.body.pdfAnexado, false);
    let disco = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    const decidido = disco.entregas.p2['9900001'];
    assert.equal(decidido.relatorio, relatorioValido, 'o espelho original deve ser preservado byte a byte');
    assert.equal(decidido.nota, 3.5); assert.equal(decidido.recurso.resultado, 'Aceito parcialmente'); assert.equal(decidido.recurso.confirmadoPeloProfessor, true);

    const loginAluno = await post('/api/login', { usuario: '9900002', senha: 'Aluno-Dois-2026' });
    const novoRecurso = await post('/api/recurso', { id: 'p2', motivo: 'Contesto o desconto atribuído à síntese dos fatos, pois a localização e a sequência temporal constam expressamente do texto entregue. Solicito conferência do item.' }, loginAluno.cookie);
    assert.equal(novoRecurso.status, 200, JSON.stringify(novoRecurso.body)); assert.equal(novoRecurso.body.professoresAvisados, 1);
    const avisos = await get('/api/avisos-professor', loginProfessor.cookie);
    assert.equal(avisos.status, 200); assert.equal(avisos.body.avisos.length, 1); assert.equal(avisos.body.avisos[0].matricula, '9900002');
    const lido = await post('/api/avisos-professor/lido', { id: avisos.body.avisos[0].id }, loginProfessor.cookie);
    assert.equal(lido.status, 200); assert.equal((await get('/api/avisos-professor', loginProfessor.cookie)).body.avisos.length, 0);
    disco = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    assert.equal(disco.avisosProfessores[0].emails.length, 1, 'o sistema deve tentar avisar por e-mail o professor responsável');
    console.log('OK: recurso gera decisão simples confirmada pelo professor e aviso persistente com tentativa de e-mail.');
  } finally { child.kill(); ia.close(); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
