const crypto = require('crypto');

// Bases anteriores a esta mudança não tinham versão explícita e são tratadas
// como schema 0. A versão só é avançada depois que toda a migração termina.
const SCHEMA_VERSION_ATUAL = 2;

function versaoSchema(base) {
  const valor = Number(base && base.schemaVersion);
  return Number.isInteger(valor) && valor >= 0 ? valor : 0;
}

function jsonCanonico(valor) {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  if (Array.isArray(valor)) return '[' + valor.map(jsonCanonico).join(',') + ']';
  return '{' + Object.keys(valor).sort().map(chave => JSON.stringify(chave) + ':' + jsonCanonico(valor[chave])).join(',') + '}';
}

function identificadorBackup(base, stateId, destino) {
  const origem = versaoSchema(base);
  const hash = crypto.createHash('sha256').update(jsonCanonico(base)).digest('hex');
  const escopo = String(stateId || 'main').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'main';
  return `backup-pre-migracao-${escopo}-v${origem}-para-v${destino}-${hash}`;
}

async function garantirBackupPreMigracaoSupabase(opcoes) {
  const base = opcoes && opcoes.base;
  const destino = Number((opcoes && opcoes.schemaVersionAtual) || SCHEMA_VERSION_ATUAL);
  const origem = versaoSchema(base);
  if (origem >= destino) return { necessario: false, confirmado: false, versaoOrigem: origem, schemaVersion: destino };
  if (!(opcoes && opcoes.ativo)) return { necessario: true, confirmado: false, versaoOrigem: origem, schemaVersion: destino };
  if (typeof opcoes.fetchComTimeout !== 'function') throw new TypeError('fetchComTimeout é obrigatório para confirmar o backup pré-migração.');
  if (typeof opcoes.cabecalhos !== 'function') throw new TypeError('cabecalhos é obrigatório para confirmar o backup pré-migração.');

  const id = identificadorBackup(base, opcoes.stateId, destino);
  const tabela = String(opcoes.tabela || 'app_state');
  const raiz = String(opcoes.url || '').replace(/\/+$/, '');
  const snapshot = JSON.parse(JSON.stringify(base));
  const headers = opcoes.cabecalhos(opcoes.chave);
  const urlInsercao = `${raiz}/rest/v1/${tabela}`;
  const insercao = await opcoes.fetchComTimeout(urlInsercao, {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'application/json',
      // Sem upsert: uma linha de backup já existente jamais é sobrescrita.
      prefer: 'return=minimal'
    },
    body: JSON.stringify({ id, data: snapshot, updated_at: new Date().toISOString() })
  }, 15000);
  // Em uma reinicialização após queda, o mesmo conteúdo produz o mesmo ID. O
  // conflito é aceitável somente se a leitura abaixo confirmar o mesmo JSON.
  if (!insercao.ok && insercao.status !== 409) throw new Error(`Supabase retornou HTTP ${insercao.status} ao criar backup pré-migração`);

  const urlConfirmacao = `${raiz}/rest/v1/${tabela}?select=id,data&id=eq.${encodeURIComponent(id)}&limit=1`;
  const confirmacao = await opcoes.fetchComTimeout(urlConfirmacao, { headers }, 15000);
  if (!confirmacao.ok) throw new Error(`Supabase retornou HTTP ${confirmacao.status} ao confirmar backup pré-migração`);
  const linhas = await confirmacao.json();
  const linha = Array.isArray(linhas) ? linhas[0] : null;
  if (!linha || linha.id !== id || jsonCanonico(linha.data) !== jsonCanonico(snapshot)) {
    throw new Error('O backup pré-migração não pôde ser confirmado integralmente no Supabase.');
  }
  return { necessario: true, confirmado: true, backupId: id, versaoOrigem: origem, schemaVersion: destino };
}

module.exports = {
  SCHEMA_VERSION_ATUAL,
  garantirBackupPreMigracaoSupabase,
  identificadorBackup,
  jsonCanonico,
  versaoSchema
};
