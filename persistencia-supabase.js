const crypto = require('crypto');

function hashSnapshot(snapshot) {
  return crypto.createHash('sha256').update(String(snapshot || '')).digest('hex');
}

// Serializa todas as escritas remotas. Apenas o snapshot pendente mais novo
// pode substituir outro que ainda nao comecou; uma escrita em voo nunca e
// interrompida nem ultrapassada por outra.
function criarCoordenadorSupabase(opcoes) {
  const ativo = !!(opcoes && opcoes.ativo);
  const salvarRemoto = opcoes && opcoes.salvarRemoto;
  const aoFalhar = (opcoes && opcoes.aoFalhar) || (() => {});
  const criarTimer = (opcoes && opcoes.criarTimer) || ((fn, ms) => setTimeout(fn, ms));
  const cancelarTimer = (opcoes && opcoes.cancelarTimer) || (timer => clearTimeout(timer));
  const retryInicialMs = Math.max(1, Number((opcoes && opcoes.retryInicialMs) || 1000));
  const retryMaximoMs = Math.max(retryInicialMs, Number((opcoes && opcoes.retryMaximoMs) || 60000));

  if (ativo && typeof salvarRemoto !== 'function') throw new TypeError('salvarRemoto e obrigatorio quando o coordenador esta ativo.');

  let proximaRevisao = 0;
  let revisaoConfirmada = 0;
  let hashConfirmado = '';
  let confirmacaoIncerta = false;
  let emVoo = null;
  let pendente = null;
  let retryTimer = null;
  let retryMs = retryInicialMs;
  const esperas = [];
  const observadoresMudanca = new Set();

  function sinalizarMudanca() {
    for (const observar of Array.from(observadoresMudanca)) {
      observadoresMudanca.delete(observar);
      try { observar(); } catch {}
    }
  }

  function aguardarMudanca(timeoutMs) {
    return new Promise((resolve, reject) => {
      let timer;
      const observar = () => {
        if (timer) clearTimeout(timer);
        resolve();
      };
      observadoresMudanca.add(observar);
      timer = setTimeout(() => {
        observadoresMudanca.delete(observar);
        const erro = new Error('Tempo limite ao drenar a fila de persistencia do Supabase.');
        erro.code = 'PERSISTENCIA_DRENO_TIMEOUT';
        reject(erro);
      }, Math.max(1, timeoutMs));
    });
  }

  function itemMaisNovo() { return pendente || emVoo; }

  function resolverConfirmadas() {
    for (let i = esperas.length - 1; i >= 0; i--) {
      if (esperas[i].revisao > revisaoConfirmada) continue;
      const espera = esperas.splice(i, 1)[0];
      espera.resolve({ revisao: revisaoConfirmada });
    }
  }

  function rejeitarAte(revisao, erro) {
    for (let i = esperas.length - 1; i >= 0; i--) {
      if (esperas[i].revisao > revisao) continue;
      const espera = esperas.splice(i, 1)[0];
      espera.reject(erro);
    }
  }

  function confirmarSemPost(item) {
    revisaoConfirmada = Math.max(revisaoConfirmada, item.revisao);
    hashConfirmado = item.hash;
    resolverConfirmadas();
    sinalizarMudanca();
  }

  function iniciarSePossivel() {
    if (!ativo || emVoo || retryTimer || !pendente) return;
    if (!confirmacaoIncerta && hashConfirmado && pendente.hash === hashConfirmado) {
      const redundante = pendente;
      pendente = null;
      confirmarSemPost(redundante);
      if (pendente) iniciarSePossivel();
      return;
    }
    emVoo = pendente;
    pendente = null;
    sinalizarMudanca();
    const atual = emVoo;
    Promise.resolve()
      .then(() => salvarRemoto(atual.snapshot, atual.revisao))
      .then(() => {
        revisaoConfirmada = Math.max(revisaoConfirmada, atual.revisao);
        hashConfirmado = atual.hash;
        confirmacaoIncerta = false;
        retryMs = retryInicialMs;
        resolverConfirmadas();
        sinalizarMudanca();
      })
      .catch(erroOriginal => {
        const erro = erroOriginal instanceof Error ? erroOriginal : new Error(String(erroOriginal || 'Falha ao salvar no Supabase.'));
        // Uma falha de rede pode acontecer depois de o servidor remoto ter
        // aplicado a escrita. O hash so volta a ser confiavel apos novo POST.
        confirmacaoIncerta = true;
        rejeitarAte(atual.revisao, erro);
        if (!pendente || pendente.revisao < atual.revisao) pendente = atual;
        try { aoFalhar(erro, atual.revisao); } catch {}
        const espera = retryMs;
        retryMs = Math.min(retryMs * 2, retryMaximoMs);
        retryTimer = criarTimer(() => {
          retryTimer = null;
          sinalizarMudanca();
          iniciarSePossivel();
        }, espera);
        if (retryTimer && typeof retryTimer.unref === 'function') retryTimer.unref();
        sinalizarMudanca();
      })
      .finally(() => {
        if (emVoo === atual) emVoo = null;
        sinalizarMudanca();
        if (!retryTimer) iniciarSePossivel();
      });
  }

  function enfileirar(snapshot) {
    if (!ativo) return 0;
    const texto = String(snapshot || '');
    const hash = hashSnapshot(texto);
    const maisNovo = itemMaisNovo();
    if (maisNovo && maisNovo.hash === hash) return maisNovo.revisao;
    if (!maisNovo && !confirmacaoIncerta && hashConfirmado && hashConfirmado === hash) return revisaoConfirmada;
    const item = { revisao: ++proximaRevisao, snapshot: texto, hash };
    // Coalescencia ocorre somente aqui, antes do inicio do POST.
    pendente = item;
    sinalizarMudanca();
    iniciarSePossivel();
    return item.revisao;
  }

  function aguardar(revisao) {
    if (!ativo || revisao <= revisaoConfirmada) return Promise.resolve({ revisao: revisaoConfirmada });
    const promessa = new Promise((resolve, reject) => esperas.push({ revisao, resolve, reject }));
    // Uma operacao critica nao precisa aguardar o backoff de uma tentativa
    // anterior: ela forca imediatamente a escrita mais nova ainda pendente.
    if (retryTimer) {
      cancelarTimer(retryTimer);
      retryTimer = null;
      sinalizarMudanca();
      iniciarSePossivel();
    } else iniciarSePossivel();
    return promessa;
  }

  function definirConfirmado(snapshot) {
    if (!ativo) return;
    if (emVoo || pendente) throw new Error('O estado remoto inicial deve ser definido antes de enfileirar gravacoes.');
    hashConfirmado = hashSnapshot(snapshot);
    confirmacaoIncerta = false;
  }

  function estado() {
    return {
      proximaRevisao,
      revisaoConfirmada,
      hashConfirmado,
      confirmacaoIncerta,
      revisaoEmVoo: emVoo && emVoo.revisao,
      revisaoPendente: pendente && pendente.revisao,
      esperas: esperas.length,
      emRetry: !!retryTimer
    };
  }

  // Aguarda toda a fila existente, inclusive repeticoes apos falhas transitorias.
  // Durante o encerramento o backoff e antecipado para dar a ultima oportunidade
  // de confirmar o snapshot mais novo antes de o processo terminar.
  async function drenar(timeoutMs) {
    if (!ativo) return { revisao: revisaoConfirmada, drenado: true };
    const limite = Math.max(1, Number(timeoutMs || 10000));
    const fim = Date.now() + limite;
    while (true) {
      if (retryTimer) {
        cancelarTimer(retryTimer);
        retryTimer = null;
        sinalizarMudanca();
      }
      iniciarSePossivel();
      if (!emVoo && !pendente && !retryTimer) return { revisao: revisaoConfirmada, drenado: true };
      const restante = fim - Date.now();
      if (restante <= 0) {
        const erro = new Error('Tempo limite ao drenar a fila de persistencia do Supabase.');
        erro.code = 'PERSISTENCIA_DRENO_TIMEOUT';
        throw erro;
      }
      await aguardarMudanca(restante);
    }
  }

  function encerrar() {
    if (retryTimer) cancelarTimer(retryTimer);
    retryTimer = null;
    const erro = new Error('Coordenador de persistencia encerrado.');
    while (esperas.length) esperas.pop().reject(erro);
    while (observadoresMudanca.size) {
      const observar = observadoresMudanca.values().next().value;
      observadoresMudanca.delete(observar);
      try { observar(); } catch {}
    }
  }

  return { enfileirar, aguardar, definirConfirmado, estado, drenar, encerrar };
}

module.exports = { criarCoordenadorSupabase, hashSnapshot };
