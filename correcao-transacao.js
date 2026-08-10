'use strict';

const CAMPOS_CORRECAO = [
  'relatorio', 'robotizacao', 'notaSugerida', 'corrigidoEm', 'corrigidoPor',
  'modeloCorrecao', 'versaoPromptCorrecao', 'versaoGabaritoCorrecao', 'nota',
  'validado', 'validadoEm', 'validadoPor', 'validacaoAutomatica', 'revisaoHumana',
  'emailCorrecaoEnviado', 'recurso'
];

function clonar(valor) {
  return valor == null ? valor : JSON.parse(JSON.stringify(valor));
}

function capturarEstadoCorrecao(entrega) {
  const estado = {};
  for (const campo of CAMPOS_CORRECAO) estado[campo] = Object.prototype.hasOwnProperty.call(entrega, campo)
    ? { existe: true, valor: clonar(entrega[campo]) }
    : { existe: false };
  return estado;
}

function restaurarEstadoCorrecao(entrega, estado) {
  for (const campo of CAMPOS_CORRECAO) {
    const anterior = estado && estado[campo];
    if (anterior && anterior.existe) entrega[campo] = clonar(anterior.valor);
    else delete entrega[campo];
  }
  return entrega;
}

function aplicarResultadoCorrecao(entrega, resultado, professor) {
  entrega.relatorio = resultado.relatorio;
  entrega.robotizacao = resultado.robotizacao;
  entrega.notaSugerida = resultado.notaSugerida;
  entrega.corrigidoEm = Date.now();
  entrega.corrigidoPor = professor;
  entrega.modeloCorrecao = resultado.modeloCorrecao;
  entrega.versaoPromptCorrecao = resultado.versaoPromptCorrecao;
  entrega.versaoGabaritoCorrecao = resultado.versaoGabarito;
  return entrega;
}

module.exports = { CAMPOS_CORRECAO, capturarEstadoCorrecao, restaurarEstadoCorrecao, aplicarResultadoCorrecao };
