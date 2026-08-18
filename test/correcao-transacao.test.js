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
assert.match(servidor, /processarLoteCorrecao[\s\S]*await salvarDbCritico\(\);\s*correcaoPersistida = true;[\s\S]*catch \(err\) \{[\s\S]*if \(correcaoPersistida\) continue;\s*limparEstadoTentativa\(e, estadoInicial\)/, 'cada rascunho do lote deve ser uma transação isolada e permanecer salvo após a persistência crítica');
assert.match(servidor, /relatorioIAInvalido[\s\S]*correcao-incompleta-ou-invalida/, 'reinício do servidor deve remover resíduos antigos de IA');
assert.match(servidor, /d\.stop_reason === 'max_tokens'[\s\S]*Continue exatamente do ponto em que parou[\s\S]*partesTruncadas\.concat/, 'resposta truncada deve ser continuada e reunida automaticamente');
assert.match(servidor, /SISTEMA_CORRECAO_CRITERIOSO, preparada\.usuario, 9000/, 'correção definitiva deve ter margem de saída suficiente sem manter o teto antigo de 14 mil tokens');
assert.match(servidor, /resposta_original_apenas_para_comparacao[\s\S]*não reproduza dela nenhuma sequência de 12 ou mais palavras/, 'o reparo deve receber a resposta original e remover transcrições extensas de forma explícita');
const correcaoIndividual = servidor.slice(servidor.indexOf('async function entregaCorrigirIA'), servidor.indexOf('async function entregaCorrigirIAStatus'));
assert.doesNotMatch(correcaoIndividual, /for \(let tentativa = 1; tentativa <= 2/, 'a correção individual não deve repetir externamente uma geração integral');
assert.match(correcaoIndividual, /const resultado = await gerarRelatorioCorrecao[\s\S]*job\.tentativas = 1/, 'uma nova tentativa integral deve depender de nova ação do professor');
assert.match(servidor, /entregaCorrigirIA[\s\S]*aplicarResultadoCorrecao\(e, resultado, sess\.usuario\)[\s\S]*e\.validado = false[\s\S]*await salvarDbCritico\(\)/, 'a geração individual também deve persistir somente um rascunho não validado');
assert.match(servidor, /DENSIDADE ARGUMENTATIVA DA DEFESA:[\s\S]*no máximo 50%[\s\S]*no máximo 25%/, 'tópicos defensivos superficiais devem sofrer desconto proporcional explícito');
assert.match(servidor, /triagem_densidade_argumentativa[\s\S]*aplicarValidacaoDensidade/, 'a triagem determinística de densidade deve participar da geração e da validação da correção');
assert.match(servidor, /const MODELO_CORRECAO = process\.env\.MODELO_CORRECAO \|\| 'claude-sonnet-5'/, 'correção comum deve usar Sonnet por padrão');
assert.match(servidor, /function correcaoExigeOpus[\s\S]*exigeBuscaOficial\(e && e\.texto\)[\s\S]*avan\[cç\]ado/, 'jurisprudência, URL ou caso avançado deve ser classificado como alto risco');
assert.match(servidor, /const modeloInicial = altoRisco \? MODELO_AUDITORIA : MODELO_CORRECAO/, 'somente correções de alto risco devem começar no Opus');
assert.match(servidor, /SISTEMA_REPARO_CORRECAO, reparo, 7500, false, sess, \{ model: MODELO_REPARO,[^}]*operacao: 'correcao-reparo' \}/, 'primeiro reparo estrutural deve permanecer compacto no Sonnet e registrar sua operação');
assert.match(servidor, /falhas_persistentes[\s\S]*SISTEMA_CORRECAO_CRITERIOSO, usuarioEscalonado, 9000[\s\S]*\{ model: MODELO_AUDITORIA,[^}]*operacao: 'correcao-escalonamento' \}/, 'falha persistente do validador deve escalar para Opus com teto inferior ao antigo e registrar sua operação');
assert.match(servidor, /modeloCorrecao: modeloUtilizado/, 'persistência deve registrar o modelo real da resposta aceita');
assert.doesNotMatch(servidor, /max_tokens: Math\.max\(8000/, 'iaTexto não deve impor piso artificial de 8 mil tokens');
assert.match(servidor, /'precorrecao-inicial': 5000[\s\S]*'precorrecao-reparo': 4500[\s\S]*'correcao-padrao': 9000[\s\S]*'correcao-reparo': 7500[\s\S]*'gabarito-geracao': 12000/, 'limites de saída devem refletir a complexidade de cada operação');
assert.match(servidor, /Não repita nem resuma integralmente o enunciado, o gabarito ou a resposta recebida[\s\S]*Preserve, porém, todas as seções, linhas do espelho, fontes, cálculos e justificativas obrigatórias/, 'objetividade não pode remover seções, espelho, fontes, cálculos ou justificativas obrigatórias');

console.log('OK: correções interrompidas são transacionais e não deixam resíduos.');
