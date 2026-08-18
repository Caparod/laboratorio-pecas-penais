const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { criarCoordenadorSupabase } = require('../persistencia-supabase');

function adiar() {
  let resolve, reject;
  const promise = new Promise((ok, falha) => { resolve = ok; reject = falha; });
  return { promise, resolve, reject };
}

async function ciclo() {
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

async function testarSerializacaoECoalescencia() {
  const chamadas = [];
  let ativas = 0, maxAtivas = 0;
  const respostas = [];
  const coordenador = criarCoordenadorSupabase({
    ativo: true,
    salvarRemoto: snapshot => {
      chamadas.push(snapshot);
      ativas++;
      maxAtivas = Math.max(maxAtivas, ativas);
      const resposta = adiar();
      respostas.push(resposta);
      return resposta.promise.finally(() => { ativas--; });
    }
  });

  const revisaoA = coordenador.enfileirar('{"estado":"A"}');
  await ciclo();
  const revisaoB = coordenador.enfileirar('{"estado":"B"}');
  const revisaoC = coordenador.enfileirar('{"estado":"C"}');
  const esperaA = coordenador.aguardar(revisaoA);
  const esperaC = coordenador.aguardar(revisaoC);

  assert.deepEqual(chamadas, ['{"estado":"A"}'], 'snapshot em voo nao pode ser ultrapassado');
  assert.equal(revisaoB + 1, revisaoC, 'cada estado novo deve receber revisao monotona');
  respostas[0].resolve();
  await esperaA;
  await ciclo();
  assert.deepEqual(chamadas, ['{"estado":"A"}', '{"estado":"C"}'], 'somente o snapshot pendente mais novo deve sobreviver a coalescencia');
  respostas[1].resolve();
  await esperaC;
  assert.equal(maxAtivas, 1, 'nunca pode haver dois POSTs remotos simultaneos');
  assert.equal(coordenador.estado().revisaoConfirmada, revisaoC, 'a revisao remota final deve ser a mais nova');
  coordenador.encerrar();
}

async function testarCriticoUnicoENoop() {
  const chamadas = [];
  const coordenador = criarCoordenadorSupabase({
    ativo: true,
    salvarRemoto: async snapshot => { chamadas.push(snapshot); }
  });

  const revisao = coordenador.enfileirar('{"critico":true}');
  await coordenador.aguardar(revisao);
  assert.equal(chamadas.length, 1, 'uma persistencia critica deve realizar exatamente um POST');

  const mesmaRevisao = coordenador.enfileirar('{"critico":true}');
  await coordenador.aguardar(mesmaRevisao);
  assert.equal(mesmaRevisao, revisao, 'snapshot remoto identico deve reutilizar a revisao confirmada');
  assert.equal(chamadas.length, 1, 'snapshot remoto identico nao deve gerar POST no-op');

  const carregado = criarCoordenadorSupabase({
    ativo: true,
    salvarRemoto: async snapshot => { chamadas.push(snapshot); }
  });
  carregado.definirConfirmado('{"ja":"remoto"}');
  await carregado.aguardar(carregado.enfileirar('{"ja":"remoto"}'));
  assert.equal(chamadas.length, 1, 'estado acabado de carregar do Supabase nao deve ser reenviado sem alteracao');
  coordenador.encerrar();
  carregado.encerrar();
}

function testarIntegracaoDoServidor() {
  const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const bloco = servidor.match(/async function salvarDbCritico\(\) \{[\s\S]*?\n\}/);
  assert.ok(bloco, 'o servidor deve manter uma funcao explicita para persistencia critica');
  assert.match(bloco[0], /await coordenadorSupabase\.aguardar\(revisaoAlvo\)/, 'persistencia critica deve aguardar a revisao enfileirada');
  assert.doesNotMatch(bloco[0], /salvarDbSupabase\s*\(/, 'persistencia critica nao pode abrir um segundo POST direto');
  assert.match(servidor, /async function encerrarComPersistencia\(sinal\)[\s\S]*coordenadorSupabase\.drenar\(timeoutMs\)/, 'encerramento deve drenar a fila antes de terminar');
  assert.match(servidor, /process\.once\('SIGTERM',[^\n]*encerrarComPersistencia\('SIGTERM'\)/, 'SIGTERM deve acionar o encerramento coordenado');
  assert.match(servidor, /process\.once\('SIGINT',[\s\S]*encerrarComPersistencia\('SIGINT'\)/, 'SIGINT deve usar o mesmo encerramento coordenado');
  assert.match(servidor, /delete db\.entregas\[p\.id\]\[matricula\];[\s\S]{0,300}await salvarDbCritico\(\)/, 'rollback de entrega externa deve enfileirar e aguardar o snapshot revertido');
  assert.match(servidor, /delete e\.recurso;[\s\S]{0,300}await salvarDbCritico\(\)/, 'rollback de recurso deve enfileirar e aguardar o snapshot revertido');
  const notificacao = servidor.match(/const publicacoesEmNotificacao = new Set\(\);[\s\S]*?\n\}\nlet publicacoesAgendadasEmProcessamento/);
  assert.ok(notificacao, 'notificação de publicação deve ter trava explícita');
  assert.match(notificacao[0], /await enviarEmail\([\s\S]*pp\.avisadoAlunos = Date\.now\(\)/, 'publicação só pode ser marcada como avisada depois do envio');
  assert.match(notificacao[0], /notificacoesPublicacao[\s\S]*status === 'enviado'/, 'retry deve reaproveitar destinatários já concluídos');
  assert.match(notificacao[0], /finally \{ publicacoesEmNotificacao\.delete\(chave\); \}/, 'trava deve ser liberada mesmo após falha');
}

async function testarDrenoAguardaSnapshotMaisNovo() {
  const chamadas = [], respostas = [];
  const coordenador = criarCoordenadorSupabase({
    ativo: true,
    salvarRemoto: snapshot => { chamadas.push(snapshot); const resposta = adiar(); respostas.push(resposta); return resposta.promise; }
  });
  coordenador.enfileirar('{"estado":"A"}');
  await ciclo();
  coordenador.enfileirar('{"estado":"B"}');
  let terminou = false;
  const dreno = coordenador.drenar(1000).then(r => { terminou = true; return r; });
  respostas[0].resolve();
  await ciclo();
  assert.deepEqual(chamadas, ['{"estado":"A"}', '{"estado":"B"}']);
  assert.equal(terminou, false, 'dreno nao pode terminar enquanto o snapshot mais novo estiver em voo');
  respostas[1].resolve();
  const resultado = await dreno;
  assert.equal(resultado.drenado, true);
  assert.equal(coordenador.estado().revisaoPendente, null);
  coordenador.encerrar();
}

async function testarDrenoRespeitaTimeout() {
  const coordenador = criarCoordenadorSupabase({ ativo: true, salvarRemoto: () => new Promise(() => {}) });
  coordenador.enfileirar('{"preso":true}');
  await assert.rejects(coordenador.drenar(25), erro => erro && erro.code === 'PERSISTENCIA_DRENO_TIMEOUT');
  coordenador.encerrar();
}

async function testarFalhaMantemSomenteMaisNovo() {
  const chamadas = [];
  const timers = [];
  let tentativa = 0;
  const coordenador = criarCoordenadorSupabase({
    ativo: true,
    retryInicialMs: 10,
    criarTimer: fn => { const timer = { fn, cancelado: false }; timers.push(timer); return timer; },
    cancelarTimer: timer => { timer.cancelado = true; },
    salvarRemoto: async snapshot => {
      chamadas.push(snapshot);
      tentativa++;
      if (tentativa === 1) throw new Error('falha simulada');
    }
  });

  const revisaoFalha = coordenador.enfileirar('{"estado":"falhou"}');
  const esperaFalha = coordenador.aguardar(revisaoFalha);
  await assert.rejects(esperaFalha, /falha simulada/, 'o chamador critico deve receber a falha da tentativa que aguardava');
  await ciclo();
  assert.equal(timers.length, 1, 'falha deve deixar uma repeticao agendada');
  assert.equal(coordenador.estado().revisaoPendente, revisaoFalha, 'snapshot falho deve permanecer pendente enquanto nao houver estado mais novo');

  const revisaoNova = coordenador.enfileirar('{"estado":"mais novo"}');
  const esperaNova = coordenador.aguardar(revisaoNova);
  await esperaNova;
  assert.equal(timers[0].cancelado, true, 'persistencia critica nova deve antecipar o retry');
  assert.deepEqual(chamadas, ['{"estado":"falhou"}', '{"estado":"mais novo"}'], 'estado novo deve substituir o retry pendente sem reordenar nem repostar o antigo');
  assert.equal(coordenador.estado().revisaoConfirmada, revisaoNova, 'sucesso posterior deve confirmar a revisao mais nova');
  assert.equal(coordenador.estado().confirmacaoIncerta, false, 'um POST bem-sucedido deve restaurar a certeza do hash remoto');
  coordenador.encerrar();
}

async function executar() {
  await testarSerializacaoECoalescencia();
  await testarCriticoUnicoENoop();
  testarIntegracaoDoServidor();
  await testarFalhaMantemSomenteMaisNovo();
  await testarDrenoAguardaSnapshotMaisNovo();
  await testarDrenoRespeitaTimeout();
  console.log('OK: persistencia Supabase serial, versionada, sem POST duplicado ou regressao.');
}

executar().catch(erro => { console.error(erro.stack || erro); process.exitCode = 1; });
