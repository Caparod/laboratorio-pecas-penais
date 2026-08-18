const assert = require('assert');
const {
  SCHEMA_VERSION_ATUAL,
  garantirBackupPreMigracaoSupabase,
  identificadorBackup,
  versaoSchema
} = require('../migracao-supabase');

function resposta(status, corpo) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo };
}

const cabecalhos = chave => ({ apikey: chave, authorization: 'Bearer ' + chave });

async function executar() {
  const legado = {
    professor: { login: 'admin', senha: 'hash:legado' },
    alunos: { '001': { nome: 'Aluno', turmaIds: ['t1'] } },
    pecas: {},
    entregas: {},
    valorNulo: null,
    lista: [3, { z: true, a: 'texto' }]
  };
  assert.equal(versaoSchema(legado), 0);
  const idEsperado = identificadorBackup(legado, 'main', SCHEMA_VERSION_ATUAL);
  let linhaSalva = null;
  let insercoes = 0;
  const fetchComTimeout = async (url, opcoes) => {
    if (opcoes && opcoes.method === 'POST') {
      insercoes++;
      assert.ok(!url.includes('on_conflict'), 'backup não pode usar upsert');
      assert.ok(!String(opcoes.headers.prefer || '').includes('resolution='), 'backup não pode permitir sobrescrita em conflito');
      linhaSalva = JSON.parse(opcoes.body);
      assert.equal(linhaSalva.id, idEsperado);
      assert.deepEqual(linhaSalva.data, legado, 'a coluna data deve conter exatamente o JSON pré-migração');
      return resposta(201, null);
    }
    assert.ok(url.includes(encodeURIComponent(idEsperado)), 'a confirmação deve reler a linha exata do backup');
    return resposta(200, [linhaSalva]);
  };
  const resultado = await garantirBackupPreMigracaoSupabase({
    ativo: true,
    base: legado,
    url: 'https://projeto.supabase.co',
    chave: 'service-role-teste',
    tabela: 'app_state',
    stateId: 'main',
    cabecalhos,
    fetchComTimeout
  });
  assert.equal(resultado.confirmado, true);
  assert.equal(resultado.backupId, idEsperado);
  assert.equal(insercoes, 1);

  // Um boot posterior, já na versão atual, não tenta inserir outro backup.
  const atual = { schemaVersion: SCHEMA_VERSION_ATUAL, migracaoSchema: { backupConfirmado: true } };
  const posterior = await garantirBackupPreMigracaoSupabase({
    ativo: true,
    base: atual,
    url: 'https://projeto.supabase.co',
    chave: 'service-role-teste',
    cabecalhos,
    fetchComTimeout: async () => { throw new Error('não deveria acessar a rede'); }
  });
  assert.equal(posterior.necessario, false);
  assert.equal(versaoSchema({ schemaVersion: SCHEMA_VERSION_ATUAL + 1 }), SCHEMA_VERSION_ATUAL + 1);

  // Se o processo caiu depois da inserção, o conflito confirma o backup já
  // existente sem alterá-lo.
  let confirmouConflito = false;
  const recuperado = await garantirBackupPreMigracaoSupabase({
    ativo: true,
    base: legado,
    url: 'https://projeto.supabase.co',
    chave: 'service-role-teste',
    cabecalhos,
    fetchComTimeout: async (url, opcoes) => {
      if (opcoes && opcoes.method === 'POST') return resposta(409, { erro: 'duplicate key' });
      confirmouConflito = true;
      return resposta(200, [{ id: idEsperado, data: legado }]);
    }
  });
  assert.equal(recuperado.confirmado, true);
  assert.equal(confirmouConflito, true);

  await assert.rejects(() => garantirBackupPreMigracaoSupabase({
    ativo: true,
    base: legado,
    url: 'https://projeto.supabase.co',
    chave: 'service-role-teste',
    cabecalhos,
    fetchComTimeout: async () => resposta(500, { erro: 'falha simulada' })
  }), /backup pré-migração/);

  await assert.rejects(() => garantirBackupPreMigracaoSupabase({
    ativo: true,
    base: legado,
    url: 'https://projeto.supabase.co',
    chave: 'service-role-teste',
    cabecalhos,
    fetchComTimeout: async (url, opcoes) => opcoes && opcoes.method === 'POST'
      ? resposta(409, { erro: 'duplicate key' })
      : resposta(200, [{ id: idEsperado, data: { adulterado: true } }])
  }), /não pôde ser confirmado integralmente/);

  console.log('OK: backup Supabase pré-migração é imutável, exato, confirmado e idempotente.');
}

executar().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
