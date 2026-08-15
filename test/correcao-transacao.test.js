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

aplicarResultadoCorrecao(entrega, { relatorio: 'Relatório completo', robotizacao: { risco: 'baixo' }, notaSugerida: 4.25, modeloCorrecao: 'modelo-principal', versaoPromptCorrecao: 8, versaoGabarito: 3 }, 'professor');
assert.equal(entrega.relatorio, 'Relatório completo');
assert.equal(entrega.notaSugerida, 4.25);
assert.equal(entrega.corrigidoPor, 'professor');
assert.equal(entrega.versaoGabaritoCorrecao, 3);

const servidor = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
assert.match(servidor, /vigiarTentativa\(job[\s\S]*limparEstadoTentativa\(e, estadoInicial\)/, 'correção individual deve ter limpeza automática por prazo');
assert.match(servidor, /catch \(err\) \{\s*limparEstadoTentativa\(e, estadoInicial\)/, 'falha individual deve restaurar o estado anterior');
assert.match(servidor, /processarLoteCorrecao[\s\S]*catch \(err\) \{[\s\S]*if \(correcaoPersistida\)[\s\S]*break;\s*\}\s*limparEstadoTentativa\(e, estadoInicial\)/, 'cada aluno do lote deve ser tratado como transação isolada, sem reverter correção já persistida por falha de e-mail');
assert.match(servidor, /relatorioIAInvalido[\s\S]*correcao-incompleta-ou-invalida/, 'reinício do servidor deve remover resíduos antigos de IA');
assert.match(servidor, /d\.stop_reason === 'max_tokens'[\s\S]*Continue exatamente do ponto em que parou[\s\S]*partesTruncadas\.concat/, 'resposta truncada deve ser continuada e reunida automaticamente');
assert.match(servidor, /SISTEMA_CORRECAO_CRITERIOSO, usuario, 14000/, 'correção definitiva deve ter margem de saída suficiente');

console.log('OK: correções interrompidas são transacionais e não deixam resíduos.');
