'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const servidor = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
const interfaceHtml = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

assert.match(servidor, /itensConcluidos\.push\([\s\S]*matricula:[\s\S]*nota:/, 'o lote deve publicar cada correção concluída no status');
assert.match(servidor, /emailsEnviados:[ ]*0[\s\S]*falhasEmail:[ ]*\[\]/, 'o lote deve contabilizar envios e falhas de e-mail');
assert.match(servidor, /emailCorrecaoEnviado[ ]*=[ ]*!!\(email && email\.ok\)/, 'o resultado real do envio deve ser salvo na entrega');
assert.match(servidor, /emailCorrecaoMensagemId[ ]*=[ ]*String\(email\.mensagemId/, 'a confirmação do servidor de e-mail deve ser registrada');
assert.match(servidor, /destinatariosInvalidos[\s\S]*verificarServicoEmail\(\)/, 'o lote não deve começar sem destinatários verificados e Gmail operacional');
assert.match(servidor, /correcaoPersistida = true;\s*clearTimeout\(timer\);/, 'uma correção persistida não pode expirar enquanto o PDF é enviado');
assert.match(servidor, /for \(let tentativa = 1; tentativa <= 2; tentativa\+\+\)[\s\S]*job\.tentativasExtras\+\+/, 'falhas transitórias de correção devem receber uma repetição automática controlada');
assert.match(servidor, /for \(let tentativaEmail = 1; tentativaEmail <= 2; tentativaEmail\+\+\)/, 'o envio do PDF deve ser repetido uma vez quando houver falha transitória');
assert.match(interfaceHtml, /sincronizarConcluidasLote\(pecaId,j\.itensConcluidos\)[\s\S]*renderRodadaProposta\(pecaId\)/, 'a interface deve mover cada aluno para a coluna de corrigidas durante o lote');
assert.match(interfaceHtml, /acompanharCorrecaoTodas\(pecaId,jobId,proc\),1500/, 'o progresso deve ser atualizado continuamente sem liberar os outros botões');
assert.match(interfaceHtml, /proc\.atualizar\(pct,/, 'a barra global deve refletir o avanço real do lote');
assert.match(interfaceHtml, /Concluídas neste lote:/, 'o contador deve deixar claro que começa em zero apenas para as pendências do lote atual');
assert.match(interfaceHtml, /Todas as entregas do lote foram corrigidas/, 'a interface só deve declarar sucesso integral quando não houver falhas');
assert.match(interfaceHtml, /if\(validar&&d\.emailEnviado\)/, 'a interface só pode afirmar envio quando o servidor confirmar o e-mail');

console.log('OK: lote atualiza as colunas progressivamente e confirma os relatórios enviados por e-mail.');
