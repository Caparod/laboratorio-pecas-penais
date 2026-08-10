'use strict';

function ehJwt(chave) {
  const partes = String(chave || '').trim().split('.');
  return partes.length === 3 && partes.every(Boolean);
}

function cabecalhosSupabase(chave) {
  const valor = String(chave || '').trim();
  if (!valor) return {};
  const headers = { apikey: valor };
  // As chaves legadas service_role são JWTs e devem ser enviadas como Bearer.
  // As chaves atuais sb_secret_ não são JWTs: enviá-las como Bearer causa HTTP 401.
  if (ehJwt(valor)) headers.authorization = `Bearer ${valor}`;
  return headers;
}

module.exports = { ehJwt, cabecalhosSupabase };
