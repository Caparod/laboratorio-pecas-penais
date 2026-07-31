const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const servidor = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
const migracao = fs.readFileSync(
  path.join(raiz, 'supabase', 'migrations', '20260721000000_secure_app_state.sql'),
  'utf8'
);

assert.ok(
  !servidor.includes('SUPABASE_ANON_KEY'),
  'O estado privado da aplicação não pode usar uma chave pública do Supabase.'
);
assert.match(
  migracao,
  /alter\s+table\s+if\s+exists\s+public\.app_state\s+enable\s+row\s+level\s+security/i,
  'A migração deve ativar RLS em public.app_state.'
);
assert.match(
  migracao,
  /revoke\s+all\s+on\s+table\s+public\.app_state\s+from\s+anon\s*,\s*authenticated/i,
  'A migração deve revogar o acesso dos papéis públicos.'
);
assert.ok(
  !/create\s+policy/i.test(migracao),
  'Nenhuma política de acesso público deve ser criada para app_state.'
);

console.log('OK: RLS do Supabase e uso exclusivo da service role validados.');
