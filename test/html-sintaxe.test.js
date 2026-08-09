'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

for (const arquivo of [path.join(__dirname, '..', 'index.html'), path.join(__dirname, '..', '..', 'sistema-pecas-estagio.html')]) {
  const html = fs.readFileSync(arquivo, 'utf8');
  const blocos = Array.from(html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi), m => m[1]);
  for (const codigo of blocos) new Function(codigo);
  if (arquivo.endsWith(path.join('render-app', 'index.html'))) {
    assert.match(html, /function mostrarSenhaTemporaria\(/);
    assert.match(html, /Copiar senha/);
    assert.match(html, /mostrarSenhaTemporaria\('Senha temporária de '\+m,cred\.senha\)/);
    assert.match(html, /mostrarSenhaTemporaria\('Senha temporária de '\+login,d\.senhaTemporaria\)/);
  }
}

console.log('OK: sintaxe dos scripts das interfaces validada');
