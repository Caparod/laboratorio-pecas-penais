'use strict';
const assert = require('assert');
const { limparEnunciadoIA, limparGabaritoIA, normalizarGabaritoPenal, validarEnunciado, analisarEspelho, normalizarEspelhoCinco, detectarJurisprudencia, similaridadeNarrativa, validarGabarito, validarCorrecao } = require('../validation');

const enunciadoMarcado = '<enunciado>\n**Texto integral do caso.**\n</enunciado>';
assert.equal(limparEnunciadoIA(enunciadoMarcado), 'Texto integral do caso.', 'marcação interna da IA deve ser removida');
assert.ok(validarEnunciado(enunciadoMarcado).erros.some(e => /marca[cç][aã]o interna/i.test(e)), 'marcação interna não pode chegar à interface');
assert.equal(limparGabaritoIA('Analisando as fontes...\n## Peça cabível\nApelação.'), '## Peça cabível\nApelação.', 'comentário técnico antes do gabarito deve ser removido');
assert.equal(normalizarGabaritoPenal('## Prazo\n5 dias úteis; prazo contínuo, e não em dias corridos; art. 564, IV e V, do CPP.'), '## Prazo\n5 dias corridos; prazo contínuo, em dias corridos; art. 563 do CPP.', 'inconsistências penais conhecidas devem ser corrigidas');

const enunciado = 'No processo nº 0712345-67.2026.8.07.0001, em 10/03/2026, João da Silva foi condenado pela Vara Criminal de Brasília. A defesa foi intimada em 16/03/2026 e todos os elementos probatórios relevantes foram descritos nos autos fictícios. O acusado pretende impugnar integralmente a sentença e apresentou ao advogado cópia da decisão e das provas. Na condição de advogado(a) de João da Silva, elabore a medida processual cabível, vedado o uso de habeas corpus. (Valor: 5,00)';
assert.equal(validarEnunciado(enunciado).ok, true, 'enunciado completo deve passar');
assert.equal(validarEnunciado('Caso curto sem datas.').ok, false, 'enunciado incompleto deve falhar');
assert.equal(validarEnunciado(enunciado.replace('0712345-67.2026.8.07.0001', '2026.008installer-4')).ok, false, 'identificador corrompido deve ser bloqueado');
const queixaSemProcesso = enunciado.replace('No processo nº 0712345-67.2026.8.07.0001, ', '').replace('medida processual cabível', 'Queixa-Crime cabível');
assert.equal(validarEnunciado(queixaSemProcesso, 'Queixa-Crime').ok, true, 'Queixa-Crime inaugural não deve exigir número CNJ');
assert.equal(validarEnunciado(queixaSemProcesso, 'Apelação Criminal').ok, false, 'peça em processo existente deve continuar exigindo número CNJ');
const narrativaQuaseIgual = enunciado.replace('João da Silva', 'Marcos Pereira').replace('10/03/2026', '11/04/2026').replace('16/03/2026', '17/04/2026');
const narrativaDiferente = 'Em 02/02/2026, uma médica de hospital particular recebeu arquivos eletrônicos atribuídos a um paciente. Após perícia inconclusiva e depoimentos divergentes, o Ministério Público ofereceu denúncia por fato ocorrido em 28/01/2026. O juízo determinou sua citação e juntou apenas parte dos registros técnicos. Na condição de advogado(a) da acusada, apresente a medida adequada, vedado habeas corpus. (Valor: 5,00)';
assert.ok(similaridadeNarrativa(enunciado, narrativaQuaseIgual) >= 0.58, 'troca superficial de nomes e datas deve ser detectada');
assert.ok(similaridadeNarrativa(enunciado, narrativaDiferente) < 0.58, 'núcleos fáticos distintos não devem ser bloqueados');

const gabarito = `## Peça cabível
Apelação Criminal, com fundamento no CPP.
## Endereçamento
Ao juízo competente.
## Prazo
Cinco dias.
## Teses principais e subsidiárias
Teses conforme o caso.
## Pedidos
Conhecimento e provimento.
## Estrutura da peça — passo a passo
1. Endereçamento.
2. Razões.
## Espelho de correção
| Item | Pontuação |
|---|---:|
| Cabimento | 0,50 |
| Endereçamento | 0,50 |
| Fundamentação | 2,50 |
| Pedidos | 1,50 |
| **Total** | **5,00** |
## Erros frequentes esperados
Erro de prazo.
## Fontes
- [Código de Processo Penal](https://www.planalto.gov.br/ccivil_03/decreto-lei/del3689compilado.htm)`;

const espelho = analisarEspelho(gabarito);
const gabaritoComExcesso = gabarito.replace('| Pedidos | 1,50 |', '| Pedidos | 1,60 |');
const gabaritoNormalizado = normalizarEspelhoCinco(gabaritoComExcesso);
assert.equal(analisarEspelho(gabaritoComExcesso).soma, 5.1, 'cenário real de excesso deve ser reproduzido');
assert.equal(analisarEspelho(gabaritoNormalizado).soma, 5, 'normalização determinística deve fechar em 5,00');
assert.equal(validarGabarito(gabaritoNormalizado, 'Apelação Criminal').ok, true, 'gabarito normalizado deve permanecer válido');
assert.ok(!/\|\s*\d+,\d*[12346789]\s*\|/.test(gabaritoNormalizado), 'pontuações devem usar incrementos compatíveis com 0,05');
assert.equal(validarGabarito(gabarito.replace('Cinco dias.', 'Cinco dias úteis.'), 'Apelação Criminal').ok, false, 'prazo penal em dias úteis deve ser bloqueado');
assert.equal(espelho.soma, 5);
assert.equal(espelho.total, 5);
assert.equal(validarGabarito(gabarito, 'Apelação Criminal').ok, true, 'gabarito íntegro deve passar');
assert.equal(validarGabarito(gabarito.replace('| Pedidos | 1,50 |', '| Pedidos | 1,40 |'), 'Apelação Criminal').ok, false, 'soma diferente de 5 deve falhar');
const espelhoComDetalhamento = gabarito
  .replace('| Cabimento | 0,50 |', '| Cabimento | 0,50 (0,30 pela tese + 0,20 pelo dispositivo) |')
  .replace('| Endereçamento | 0,50 |', '| Endereçamento | 0,50 (0,30 pela forma + 0,20 pela competência) |');
assert.equal(analisarEspelho(espelhoComDetalhamento).soma, 5, 'o caso que antes aparecia como 4,40 deve fechar em 5,00');
assert.equal(validarGabarito(espelhoComDetalhamento, 'Apelação Criminal').ok, true, 'espelho FGV com decomposição deve ser aceito');
const espelhoComFormula = gabarito.replace('| Pedidos | 1,50 |', '| Pedidos | 1,00 + 0,50 = 1,50 |');
assert.equal(analisarEspelho(espelhoComFormula).soma, 5, 'fórmula explícita deve usar o total após o sinal de igual');
assert.equal(validarGabarito(gabarito, 'Habeas Corpus').ok, false, 'peça divergente deve falhar');
assert.equal(detectarJurisprudencia('Aplicação do Tema 1.234 do STJ.'), true);
assert.equal(detectarJurisprudencia('Fundamentação somente no Código Penal.'), false);

const correcao = `## Acertos
- Cabimento adequado.
## Erros formais
- Ajustar fechamento.
## Erros materiais (direito)
- Aprofundar uma tese.
## Pontuação item a item — espelho OAB/FGV
| Item | Critério avaliado | Pontos obtidos/possíveis | Justificativa detalhada |
|---|---|---:|---|
| 1 | Cabimento e endereçamento | 2,00/2,00 | A peça escolhida e o órgão destinatário correspondem integralmente ao gabarito. |
| 2 | Tempestividade e legitimidade | 1,00/1,00 | O prazo e a capacidade postulatória foram tratados corretamente. |
| 3 | Fatos e síntese | 1,00/1,00 | A narrativa preservou os fatos juridicamente relevantes do caso. |
| 4 | Fundamentação e teses | 2,00/3,00 | A tese principal foi apresentada, mas faltou aprofundar o fundamento legal indicado no espelho. |
| 5 | Pedidos | 1,00/1,50 | O pedido principal está correto, porém o pedido subsidiário exigido não foi formulado. |
| 6 | Técnica, linguagem e forma | 1,00/1,50 | A estrutura é compreensível, mas o fechamento formal precisa ser ajustado. |
## Verificação de jurisprudência e citações
- Artigos conferidos no texto oficial.
## Verificação de robotização e supervisão humana
- Risco BAIXO. Não foram observados padrões formais suficientes para indicar produção automatizada sem revisão. Esta triagem não comprova autoria e a decisão permanece humana.
NOTA SUGERIDA: 8,00/10
## Propostas de aprimoramento
- Desenvolver a tese e indicar o dispositivo correspondente, sem copiar texto pronto. A análise deve permanecer orientativa e explicar os critérios ao estudante com clareza suficiente para a revisão humana pelo professor. No pedido subsidiário, o aluno deve conferir a consequência jurídica prevista no gabarito e relacioná-la expressamente aos fatos. A organização em tópicos deve separar cabimento, mérito e pedidos, tornando visível a sequência lógica da argumentação.
## Fontes e links
- [CPP](https://www.planalto.gov.br/ccivil_03/decreto-lei/del3689compilado.htm)`;
assert.equal(validarCorrecao(correcao).ok, true, 'correção consistente deve passar');
assert.equal(validarCorrecao(correcao.replace(/\| Item \|[\s\S]*?\| 6 \|[^\n]+/, '- Cabimento: 2,00/2,00\n- Tempestividade: 1,00/1,00\n- Fatos: 1,00/1,00\n- Fundamentação: 2,00/3,00\n- Pedidos: 1,00/1,50\n- Técnica: 1,00/1,50')).ok, false, 'lista sem tabela OAB/FGV deve falhar');
assert.equal(validarCorrecao(correcao.replace('NOTA SUGERIDA: 8,00/10', 'NOTA SUGERIDA: 7,00/10')).ok, false, 'nota divergente da soma deve falhar');
assert.equal(validarCorrecao(correcao.replace('- Artigos conferidos no texto oficial.', '- Súmula 9999 — INEXISTENTE/FALSA.')).ok, false, 'citação falsa exige nota zero');

console.log('OK: contratos determinísticos de IA, espelho e correção');
