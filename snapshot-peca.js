const crypto = require('crypto');

class SnapshotPecaIndisponivelError extends Error {
  constructor(motivo) {
    super('A fotografia original da peça desta entrega está indisponível ou corrompida (' + motivo + '). A operação avaliativa foi bloqueada para não usar silenciosamente uma versão diferente.');
    this.name = 'SnapshotPecaIndisponivelError';
    this.code = 'SNAPSHOT_PECA_INDISPONIVEL';
    this.status = 409;
  }
}

// A ordem e o conjunto de campos fazem parte do formato canônico. Metadados
// específicos de uma entrega (capturadoEm, autor, motivo etc.) ficam de fora.
function snapshotCanonico(snapshot) {
  const s = snapshot || {};
  const versao = Number(s.versao);
  const rodada = Number(s.rodada);
  return {
    versao: Number.isInteger(versao) && versao > 0 ? versao : 1,
    rodada: Number.isInteger(rodada) && rodada > 0 ? rodada : null,
    nomePeca: String(s.nomePeca || ''),
    disc: String(s.disc || ''),
    turmaId: s.turmaId == null || s.turmaId === '' ? null : String(s.turmaId),
    caso: String(s.caso || ''),
    gab: String(s.gab || ''),
    prazo: String(s.prazo || ''),
    publicarEm: String(s.publicarEm || ''),
    publicada: !!s.publicada
  };
}

function hashSnapshotPeca(snapshot) {
  return crypto.createHash('sha256').update(JSON.stringify(snapshotCanonico(snapshot))).digest('hex');
}

function registrarSnapshotPeca(p, snapshot) {
  if (!p || typeof p !== 'object') throw new TypeError('Peça inválida para registrar fotografia.');
  const canonico = snapshotCanonico(snapshot);
  const ref = hashSnapshotPeca(canonico);
  if (!p.snapshots || typeof p.snapshots !== 'object' || Array.isArray(p.snapshots)) p.snapshots = {};
  if (Object.prototype.hasOwnProperty.call(p.snapshots, ref)) {
    if (hashSnapshotPeca(p.snapshots[ref]) !== ref) throw new SnapshotPecaIndisponivelError('conteúdo imutável divergente para a referência ' + ref.slice(0, 12));
  } else {
    p.snapshots[ref] = canonico;
  }
  return ref;
}

function snapshotDaEntrega(p, entrega) {
  if (!entrega || typeof entrega !== 'object') throw new SnapshotPecaIndisponivelError('entrega sem fotografia');
  // O formato legado é preservado e continua autoritativo. Não há
  // compactação nem mutação automática no boot.
  if (entrega.snapshotPeca && typeof entrega.snapshotPeca === 'object' && !Array.isArray(entrega.snapshotPeca)) return snapshotCanonico(entrega.snapshotPeca);
  const ref = String(entrega.snapshotPecaRef || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(ref)) throw new SnapshotPecaIndisponivelError(ref ? 'referência inválida' : 'referência ausente');
  const snapshots = p && p.snapshots;
  if (!snapshots || typeof snapshots !== 'object' || Array.isArray(snapshots) || !Object.prototype.hasOwnProperty.call(snapshots, ref)) {
    throw new SnapshotPecaIndisponivelError('referência ' + ref.slice(0, 12) + ' não encontrada');
  }
  const snapshot = snapshots[ref];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || hashSnapshotPeca(snapshot) !== ref) {
    throw new SnapshotPecaIndisponivelError('integridade inválida para a referência ' + ref.slice(0, 12));
  }
  return snapshotCanonico(snapshot);
}

module.exports = {
  SnapshotPecaIndisponivelError,
  snapshotCanonico,
  hashSnapshotPeca,
  registrarSnapshotPeca,
  snapshotDaEntrega
};
