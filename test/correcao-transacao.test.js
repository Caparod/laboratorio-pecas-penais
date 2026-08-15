'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { capturarEstadoCorrecao, restaurarEstadoCorrecao, aplicarResultadoCorrecao } = require('../correcao-transacao');

const entrega = { texto: 'Peça do aluno', relatorio: 'Rascunho anterior', nota: 3.5, validado: false, recurso: { status: 'pendente', motivo: 'Revisar o item.' } };
const estadoInicial = JSON.parse(JSON.stringify(entrega));
const snapshot = capturarEstadoCorrecao(entrega);
Object.assign(entrega, { relatorio: 'RELATÓRIO PARCIAL', nota: 9, notaSugerida: 9, validado: true, validadoEm: Date.now(), modeloCorrecao: 'modelo-incompleto', emailCorrecaoEnviado: false });
entrega.recurso.status = 'decidido';
restaurarEstadoCorrecao(entrega, snapshot);
assert.deepEqual(entrega, estadoInicial, 'uma correção interrompida deve restaurar exatamente relatório, nota, validação e recurso anteriores');
assert.ok(!Object.prototype.hasOwnProperty.call(entrega, 'notaSugerida'), 'campos provisórios inexistentes antes da tentativa devem ser removidos');

aplicarResultadoCorrecao(entrega, { relatorio: 'Relatório completo', robotizacao: { risco: 'baixo' }, densidadeArgumentativa: { topicosSuperficiais: [] }, notaSugerida: 4.25, modeloCorrecao: 'modelo-principal', versaoPromptCorrecao: 10, versaoGabarito: 3 }, 'professor');
assert.equal(entrega.relatorio, 'Relatório completo');
assert.equal(entrega.notaSugerida, 4.25);
assert.equal(entrega.corrigidoPor, 'professor');
assert.equal(entrega.versaoGabaritoCorrecao, 3);
assert.deepEqual(entrega.densidadeArgumentativa, { topicosSuperficiais: [] });

const servidor = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
assert.match(servidor, /vigiarTentativa\(job[\s\S]*limparEstadoTentativa\(e, estadoInicial\)/, 'correção individual deve ter limpeza automática por prazo');
assert.match(servidor, /catch \(err\) \{\s*limparEstadoTentativa\(e, estadoInicial\)/, 'falha individual deve restaurar o estado anterior');
assert.match(servidor, /processarLoteCorrecao[\s\S]*catch \(err\) \{[\s\S]*if \(correcaoPersistida\)[\s\S]*break;\s*\}\s*limparEstadoTentativa\(e, estadoInicial\)/, 'cada aluno do lote deve ser tratado como transação isolada, sem reverter correção já persistida por falha de e-mail');
assert.match(servidor, /relatorioIAInvalido[\s\S]*correcao-incompleta-ou-invalida/, 'reinício do servidor deve remover resíduos antigos de IA');
assert.match(servidor, /d\.stop_reason === 'max_tokens'[\s\S]*Continue exatamente do ponto em que parou[\s\S]*partesTruncadas\.concat/, 'resposta truncada deve ser continuada e reunida automaticamente');
assert.match(servidor, /SISTEMA_CORRECAO_CRITERIOSO, usuario, 14000/, 'correção definitiva deve ter margem de saída suficiente');
assert.match(servidor, /resposta_original_apenas_para_comparacao[\s\S]*não reproduza dela nenhuma sequência de 12 ou mais palavras/, 'o reparo deve receber a resposta original e remover transcrições extensas de forma explícita');
assert.match(servidor, /entregaCorrigirIA[\s\S]*for \(let tentativa = 1; tentativa <= 2; tentativa\+\+\)[\s\S]*if \(resultado\.ok\) break/, 'a correção individual deve repetir automaticamente uma geração inconsistente, como o lote');
assert.match(servidor, /DENSIDADE ARGUMENTATIVA DA DEFESA:[\s\S]*no máximo 50%[\s\S]*no máximo 25%/, 'tópicos defensivos superficiais devem sofrer desconto proporcional explícito');
assert.match(servidor, /triagem_densidade_argumentativa[\s\S]*aplicarValidacaoDensidade/, 'a triagem determinística de densidade deve participar da geração e da validação da correção');

console.log('OK: correções interrompidas são transacionais e não deixam resíduos.');
