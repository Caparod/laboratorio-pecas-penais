'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

for (const arquivo of [path.join(__dirname, '..', 'index.html'), path.join(__dirname, '..', '..', 'sistema-pecas-estagio.html')]) {
  const html = fs.readFileSync(arquivo, 'utf8');
  const blocos = Array.from(html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi), m => m[1]);
  for (const codigo of blocos) new Function(codigo);
  if (path.basename(arquivo) === 'index.html') {
    assert.doesNotMatch(html, /Banco Nacional de Precedentes/, 'atalho genérico sem relação com a peça não deve aparecer');
    assert.match(html, /Peças entregues/, 'área do aluno deve apresentar o histórico de peças entregues');
    assert.match(html, /Ver relatório e nota/, 'peça corrigida deve permitir abrir o relatório e a nota');
    assert.match(html, /Abrir espelho em PDF/, 'aluno deve abrir o PDF no visualizador nativo do aparelho');
    assert.match(html, /window\.location\.assign\(caminho\)/, 'PDF do aluno não deve depender de URL temporária incompatível com celular');
    assert.match(html, /function profPropostas\(/, 'área do professor deve organizar as peças propostas por rodada');
    assert.match(html, /Corrigir agora/, 'entrega pendente deve oferecer acesso direto à correção');
    assert.match(html, /Rever correção/, 'entrega corrigida deve permanecer acessível ao professor');
    assert.match(html, /function popupSelecionarRodada\(/, 'professor deve selecionar a rodada em um popup');
    assert.match(html, /A primeira peça publicada para cada turma é a Peça 1/, 'interface deve explicar a numeração sequencial das rodadas');
    assert.match(html, /Nota do Estágio \(0 a 5\)/, 'correção deve usar a escala do Estágio');
    assert.doesNotMatch(html, /Nota \(0 a 10\)/, 'campo legado de nota não pode reaparecer');
    assert.match(html, /id="btn_previa_correcao"/, 'prévia deve ter controle próprio de disponibilidade');
    assert.match(html, /function atualizarDisponibilidadePrevia\(/, 'prévia deve ser liberada somente após relatório e nota');
    assert.match(html, /function telaPesquisaAluno\(/, 'área do aluno deve incluir a pesquisa pedagógica');
    assert.match(html, /function profPesquisa\(/, 'área do professor deve incluir resultados agregados da pesquisa');
    assert.match(html, /pelo menos três respostas/, 'interface deve explicar o limite mínimo de anonimato');
    assert.match(html, /Responder pesquisa para liberar a Peça 2/, 'Peça 2 deve orientar o aluno para a pesquisa obrigatória');
    assert.match(html, /OBRIGATÓRIA/, 'todas as afirmações obrigatórias devem estar identificadas no formulário');
    assert.match(html, /\/materiais\/papel-timbrado-npj\.docx/, 'aluno deve poder baixar o papel timbrado oficial');
    assert.match(html, /\/materiais\/regras-formatacao-npj\.pdf/, 'aluno deve poder baixar as regras de formatação');
    assert.match(html, /Falhas formais comprovadas reduzem a nota final/, 'pré-correção deve alertar sobre a consequência acadêmica');
    assert.match(html, /parecer-inicial',\{id,texto,arquivo:window\.__arquivoAluno\|\|null\}/, 'auditoria autenticada do arquivo deve acompanhar a pré-correção');
    assert.doesNotMatch(html, /notaInicial\)\.replace\('\.',','\)/, 'nota numérica não pode ser preenchida com vírgula no valor interno');
  }
  if (arquivo.endsWith(path.join('render-app', 'index.html'))) {
    assert.match(html, /function mostrarSenhaTemporaria\(/);
    assert.match(html, /Copiar senha/);
    assert.match(html, /mostrarSenhaTemporaria\('Senha temporária de '\+m,cred\.senha\)/);
    assert.match(html, /mostrarSenhaTemporaria\('Senha temporária de '\+login,d\.senhaTemporaria\)/);
  }
}

console.log('OK: sintaxe dos scripts das interfaces validada');
