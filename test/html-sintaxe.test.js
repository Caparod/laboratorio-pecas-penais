'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

for (const arquivo of [path.join(__dirname, '..', 'index.html'), path.join(__dirname, '..', '..', 'sistema-pecas-estagio.html')]) {
  const html = fs.readFileSync(arquivo, 'utf8');
  const blocos = Array.from(html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi), m => m[1]);
  for (const codigo of blocos) new Function(codigo);
  if (path.basename(arquivo) === 'index.html') {
    assert.doesNotMatch(html, /Banco Nacional de Precedentes/, 'atalho genérico sem relação com a peça não deve aparecer');
    assert.match(html, /Peças entregues/, 'área do aluno deve apresentar o histórico de peças entregues');
    assert.match(html, /Ver relatório e nota/, 'peça corrigida deve permitir abrir o relatório e a nota');
  }
  if (arquivo.endsWith(path.join('render-app', 'index.html'))) {
    assert.match(html, /function mostrarSenhaTemporaria\(/);
    assert.match(html, /Copiar senha/);
    assert.match(html, /mostrarSenhaTemporaria\('Senha temporária de '\+m,cred\.senha\)/);
    assert.match(html, /mostrarSenhaTemporaria\('Senha temporária de '\+login,d\.senhaTemporaria\)/);
  }
}

console.log('OK: sintaxe dos scripts das interfaces validada');
