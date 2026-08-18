'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const servidor = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
const interfaceHtml = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

function trechoEntre(texto, inicio, fim) {
  const de = texto.indexOf(inicio);
  const ate = texto.indexOf(fim, de + inicio.length);
  assert.ok(de >= 0 && ate > de, 'não foi possível localizar o fluxo ' + inicio);
  return texto.slice(de, ate);
}

const processamento = trechoEntre(servidor, 'async function processarLoteCorrecao', 'async function entregaCorrigirTodas');
const inicioLote = trechoEntre(servidor, 'async function entregaCorrigirTodas(req, res)', 'async function entregaCorrigirTodasStatus');
const validacao = trechoEntre(servidor, 'async function validarEEnviarCorrecao', '// Professor: pedir à IA um relatório com nota para uma entrega');
const acaoProfessor = trechoEntre(servidor, 'async function entregaValidar', 'async function entregaPreviaPdf');

assert.match(processamento, /aplicarResultadoCorrecao\(e, gerada, sess\.usuario\)[\s\S]*e\.validado = false[\s\S]*await salvarDbCritico\(\)[\s\S]*rascunhosGerados\+\+/, 'cada resultado do lote deve ser persistido como rascunho não validado');
assert.match(processamento, /itensConcluidos\.push\(\{[\s\S]*temRascunho: true[\s\S]*validado: false[\s\S]*revisaoObrigatoria: true/, 'o progresso deve identificar rascunhos que aguardam revisão');
assert.doesNotMatch(processamento, /validarEEnviarCorrecao|enviarEspelhoAluno|enviarEmail\(/, 'o processamento em lote não pode validar nem enviar correções');
assert.doesNotMatch(processamento, /for \(let tentativa = 1; tentativa <= 2/, 'o lote não deve repetir externamente uma correção integral que já passou por reparo e escalonamento internos');
assert.doesNotMatch(processamento, /tentativasExtras\+\+/, 'falha final deve aguardar uma nova ação do professor');
assert.doesNotMatch(inicioLote, /destinatariosInvalidos|verificarServicoEmail/, 'cadastro ou indisponibilidade de e-mail não pode bloquear a geração dos rascunhos');
assert.match(inicioLote, /!e\.validado && !e\.relatorio/, 'o lote deve reutilizar rascunhos já persistidos em vez de gerar novamente');
assert.doesNotMatch(servidor, /automatico-sem-supervisao/, 'não pode existir modo de validação automática sem supervisão');
assert.match(validacao, /e\.revisaoHumana = \{ professor: sess\.usuario/, 'a validação deve registrar a revisão humana responsável');
assert.match(validacao, /await salvarDbCritico\(\)[\s\S]*for \(let tentativaEmail/, 'a validação revisada deve ser persistida antes de qualquer tentativa de e-mail');
assert.match(validacao, /catch \(err\) \{ email = \{ ok: false,[\s\S]*return email/, 'falha de e-mail deve virar aviso, sem desfazer a correção validada');
assert.match(acaoProfessor, /const validarAgora = d\.validar === true;[\s\S]*if \(validarAgora\)/, 'somente a ação booleana explícita do professor pode validar uma correção');
assert.match(acaoProfessor, /entregasEmCorrecao\.has[\s\S]*loteNaMesmaEntrega/, 'salvamento e validação devem aguardar o término da geração da mesma entrega');

assert.match(interfaceHtml, /Gerar rascunhos/, 'a ação coletiva deve ser apresentada como geração de rascunhos');
assert.match(interfaceHtml, /Nenhuma nota será validada e nenhum aluno receberá relatório ou e-mail/, 'a confirmação deve explicar os limites do lote');
assert.match(interfaceHtml, /sincronizarRascunhosLote\(pecaId,j\.itensConcluidos\)[\s\S]*renderRodadaProposta\(pecaId\)/, 'a interface deve publicar progressivamente cada rascunho na fila');
const sincronizacao = trechoEntre(interfaceHtml, 'function sincronizarRascunhosLote', 'async function acompanharCorrecaoTodas');
assert.match(sincronizacao, /p\.aCorrigir\.find/, 'o rascunho deve permanecer na fila A corrigir');
assert.doesNotMatch(sincronizacao, /corrigidas\.push|aCorrigir\.splice/, 'o lote não pode mover rascunhos para a lista de correções validadas');
assert.match(interfaceHtml, /proc\.atualizar\(pct,/, 'a barra global deve refletir o avanço real do lote');
assert.match(interfaceHtml, /aguardam revisão e validação individual do professor/, 'o encerramento deve orientar a revisão individual');
assert.match(interfaceHtml, /Nenhuma nota foi liberada e nenhum e-mail foi enviado ao aluno/, 'o status final não pode sugerir liberação automática');
assert.match(interfaceHtml, /O envio do e-mail falhou, mas isso não desfez a validação/, 'a interface deve separar claramente validação e notificação');

console.log('OK: lote salva rascunhos progressivamente e exige validação humana individual.');
