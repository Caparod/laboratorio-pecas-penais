'use strict';
const assert = require('assert');
const { cabecalhosSupabase } = require('../supabase-auth');

const nova = cabecalhosSupabase('sb_secret_exemplo');
assert.equal(nova.apikey, 'sb_secret_exemplo');
assert.ok(!Object.prototype.hasOwnProperty.call(nova, 'authorization'), 'chave sb_secret_ não pode ser enviada como Bearer');

const legada = cabecalhosSupabase('cabecalho.payload.assinatura');
assert.equal(legada.apikey, 'cabecalho.payload.assinatura');
assert.equal(legada.authorization, 'Bearer cabecalho.payload.assinatura', 'service_role JWT deve continuar compatível');

console.log('OK: autenticação do Supabase aceita chaves atuais e legadas sem provocar HTTP 401.');
