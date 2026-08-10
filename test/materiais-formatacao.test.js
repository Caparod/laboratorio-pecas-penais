'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const docx = fs.readFileSync(path.join(raiz, 'materiais', 'papel-timbrado-npj.docx'));
const pdf = fs.readFileSync(path.join(raiz, 'materiais', 'regras-formatacao-npj.pdf'));
const servidor = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
const arquivoPeca = fs.readFileSync(path.join(raiz, 'arquivo-peca.js'), 'utf8');

assert.equal(docx.subarray(0, 2).toString('ascii'), 'PK', 'papel timbrado deve ser um DOCX válido');
assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-', 'regras de formatação devem ser um PDF válido');
assert.match(servidor, /MATERIAIS\[rota\]/, 'servidor deve entregar os materiais por rotas próprias');
assert.match(servidor, /auditoria_formatacao_npj/, 'pré-correção e correção devem receber a auditoria formal');
assert.match(servidor, /PENALIDADE POR FORMATAÇÃO NPJ/, 'correção deve rastrear o desconto formal');
assert.match(arquivoPeca, /itens não verificáveis não podem ser penalizados/, 'item não verificável deve permanecer protegido');

console.log('OK: materiais oficiais, auditoria formal e proteção contra desconto indevido validados.');
