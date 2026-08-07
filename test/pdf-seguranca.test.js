'use strict';
const assert = require('assert');
const pkgPdf = require('pdfjs-dist/package.json');

(async () => {
  assert.equal(pkgPdf.version, '6.2.108', 'PDF.js precisa permanecer na versão corrigida');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  assert.equal(typeof pdfjs.getDocument, 'function', 'leitor de PDF precisa carregar no Node');
  console.log('OK: PDF.js corrigido e carregável');
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
