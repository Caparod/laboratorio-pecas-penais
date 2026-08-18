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
    assert.match(html, /Registrar entrega de aluno/, 'professor deve ter uma ação própria para registrar arquivo recebido fora do sistema');
    assert.match(html, /id="rep_rodada"[\s\S]*id="rep_aluno"[\s\S]*id="rep_arquivo"/, 'registro pelo professor deve exigir rodada, aluno e arquivo');
    assert.match(html, /\/api\/entrega\/registrar-professor/, 'interface deve enviar a entrega para a rota exclusiva do professor');
    assert.match(html, /Arquivo registrado em nome do aluno por/, 'tela de correção deve identificar entregas registradas pelo professor');
    assert.match(html, /Rever correção/, 'entrega corrigida deve permanecer acessível ao professor');
    assert.match(html, /Desconsiderar entrega e liberar nova pré-correção/, 'professor deve poder reabrir a pré-correção de uma entrega específica');
    assert.match(html, /Pré-correções utilizadas/, 'professor deve visualizar quem já utilizou a pré-correção de cada peça');
    assert.match(html, /function popupSelecionarRodada\(/, 'professor deve selecionar a rodada em um popup');
    assert.match(html, /A primeira peça publicada para cada turma é a Peça 1/, 'interface deve explicar a numeração sequencial das rodadas');
    assert.match(html, /Nota do Estágio \(0 a 5\)/, 'correção deve usar a escala do Estágio');
    assert.doesNotMatch(html, /Nota \(0 a 10\)/, 'campo legado de nota não pode reaparecer');
    assert.match(html, /id="btn_previa_correcao"/, 'prévia deve ter controle próprio de disponibilidade');
    assert.match(html, /function atualizarDisponibilidadePrevia\(/, 'prévia deve ser liberada somente após relatório e nota');
    assert.match(html, /function telaPesquisaAluno\(/, 'área do aluno deve incluir a pesquisa pedagógica');
    assert.match(html, /function telaPesquisaPosPeca2Aluno\(/, 'área do aluno deve incluir a pesquisa posterior à Peça 2');
    assert.match(html, /Pesquisa pós-Peça 2/, 'menu deve manter acessível a nova pesquisa');
    assert.match(html, /15\/08\/2026/, 'interface deve informar a aplicação prevista no próximo sábado');
    assert.match(html, /function profPesquisa\(/, 'área do professor deve incluir resultados agregados da pesquisa');
    assert.match(html, /pelo menos três respostas/, 'interface deve explicar o limite mínimo de anonimato');
    assert.match(html, /Responder pesquisa para liberar a Peça 2/, 'Peça 2 deve orientar o aluno para a pesquisa obrigatória');
    assert.match(html, /OBRIGATÓRIA/, 'todas as afirmações obrigatórias devem estar identificadas no formulário');
    assert.match(html, /\/materiais\/papel-timbrado-npj\.docx/, 'aluno deve poder baixar o papel timbrado oficial');
    assert.match(html, /\/materiais\/regras-formatacao-npj\.pdf/, 'aluno deve poder baixar as regras de formatação');
    assert.match(html, /Falhas formais comprovadas reduzem a nota final/, 'pré-correção deve alertar sobre a consequência acadêmica');
    assert.match(html, /parecer-inicial',\{id,texto,arquivo:window\.__arquivoAluno\|\|null\}/, 'auditoria autenticada do arquivo deve acompanhar a pré-correção');
    assert.doesNotMatch(html, /Enviar sem parecer|enviá-la sem o parecer/i, 'interface não pode oferecer caminho que contorne a pré-correção obrigatória');
    assert.match(html, /Prefira PDF ou DOCX[\s\S]*Reserve fotos e a transcrição por OCR para peças manuscritas/, 'interface deve orientar o formato de menor custo conforme o tipo de trabalho');
    assert.match(html, /id="np_publicar_em"/, 'formulário deve permitir escolher quando a peça será publicada');
    assert.match(html, /A publicação não pode acontecer depois do prazo de entrega/, 'interface deve validar a ordem entre publicação e entrega');
    assert.match(html, /function subirGabaritoPdf\(/, 'professor deve poder importar o gabarito em PDF');
    assert.match(html, /function abrirAlterarTipoPeca\(/, 'professor deve ter uma ação específica para alterar somente o tipo da peça');
    assert.match(html, /O enunciado, o gabarito, o prazo e as entregas serão preservados/, 'interface deve deixar explícito o escopo seguro da troca de tipo');
    assert.match(html, /Salvar alterações mantendo publicada/, 'edição de peça publicada não pode oferecer despublicação acidental');
    assert.match(html, /tipo:'gabarito'/, 'upload do gabarito deve solicitar a transformação específica do PDF');
    assert.match(html, /linkCitacoesHtml\(md2html\(p\.caso\)\)/, 'enunciado transformado deve ser exibido com a formatação produzida');
    assert.match(html, /function limparEstadoNaoSalvo\(/, 'logout deve apagar todo conteúdo que não foi explicitamente salvo');
    assert.match(html, /function chaveRascunhoAluno\(/, 'rascunho salvo deve ser isolado por usuário');
    assert.match(html, /sset\(chaveRascunhoAluno\(id\)/, 'rascunho do aluno só deve persistir no clique de salvar');
    assert.doesNotMatch(html, /sset\('peca_'\+id/, 'digitação e importação não podem ser gravadas silenciosamente');
    assert.doesNotMatch(html, /sset\('arquivo_'\+id/, 'arquivo importado não pode ser gravado silenciosamente');
    assert.match(html, /id="processamento_global"/, 'toda operação deve ter uma barra global de progresso');
    assert.match(html, /function iniciarProcessamento\(/, 'a interface deve centralizar o acompanhamento de processamento');
    assert.match(html, /document\.body\.classList\.contains\('operacao-critica'\)/, 'cliques conflitantes devem ser bloqueados durante operações críticas');
    assert.match(html, /async function apiPost\(u,b\)\{\s*const proc=iniciarProcessamento/, 'todas as gravações da API devem acionar a barra e a trava');
    assert.match(html, /async function apiGet\(u\)\{\s*const proc=iniciarProcessamento/, 'todos os carregamentos da API devem acionar a barra');
    assert.match(html, /acompanharCorrecaoTodas\(pecaId,jobId,proc\)/, 'o lote deve manter a trava durante todo o processamento no servidor');
    assert.doesNotMatch(html, /notaInicial\)\.replace\('\.',','\)/, 'nota numérica não pode ser preenchida com vírgula no valor interno');
    assert.match(html, /entradas e saídas podem permanecer na Anthropic por até 29 dias/i, 'aceite curto deve destacar a retenção máxima dos lotes Anthropic');
    assert.match(html, /href="\/privacidade"[\s\S]{0,200}Ler o aviso completo/i, 'aceite curto deve apontar para o aviso de privacidade completo');
    assert.match(html, /Chamadas com cobrança incerta/, 'painel de custos deve tornar pendências financeiras visíveis');
    assert.match(html, /não visualizada — registro externo do professor/, 'painel do professor não pode fingir visualização da pré-correção externa');
  }
  if (arquivo.endsWith(path.join('render-app', 'index.html'))) {
    assert.match(html, /function mostrarSenhaTemporaria\(/);
    assert.match(html, /Copiar senha/);
    assert.match(html, /mostrarSenhaTemporaria\('Senha temporária de '\+m,cred\.senha\)/);
    assert.match(html, /mostrarSenhaTemporaria\('Senha temporária de '\+login,d\.senhaTemporaria\)/);
  }
}

console.log('OK: sintaxe dos scripts das interfaces validada');
