'use strict';
const assert = require('assert');
const { validarEnunciado, analisarEspelho, detectarJurisprudencia, validarGabarito, validarCorrecao } = require('../validation');

const enunciado = 'Em 10/03/2026, João da Silva foi condenado pela Vara Criminal de Brasília. A defesa foi intimada em 16/03/2026 e todos os elementos probatórios relevantes foram descritos nos autos fictícios. O acusado pretende impugnar integralmente a sentença e apresentou ao advogado cópia da decisão e das provas. Na condição de advogado(a) de João da Silva, elabore a medida processual cabível, vedado o uso de habeas corpus. (Valor: 5,00)';
assert.equal(validarEnunciado(enunciado).ok, true, 'enunciado completo deve passar');
assert.equal(validarEnunciado('Caso curto sem datas.').ok, false, 'enunciado incompleto deve falhar');

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
assert.equal(espelho.soma, 5);
assert.equal(espelho.total, 5);
assert.equal(validarGabarito(gabarito, 'Apelação Criminal').ok, true, 'gabarito íntegro deve passar');
assert.equal(validarGabarito(gabarito.replace('| Pedidos | 1,50 |', '| Pedidos | 1,40 |'), 'Apelação Criminal').ok, false, 'soma diferente de 5 deve falhar');
assert.equal(validarGabarito(gabarito, 'Habeas Corpus').ok, false, 'peça divergente deve falhar');
assert.equal(detectarJurisprudencia('Aplicação do Tema 1.234 do STJ.'), true);
assert.equal(detectarJurisprudencia('Fundamentação somente no Código Penal.'), false);

const correcao = `## Acertos
- Cabimento adequado.
## Erros formais
- Ajustar fechamento.
## Erros materiais (direito)
- Aprofundar uma tese.
## Pontuação item a item
- Cabimento: 2,00/2,00
- Tempestividade: 1,00/1,00
- Fatos: 1,00/1,00
- Fundamentação: 2,00/3,00
- Pedidos: 1,00/1,50
- Técnica: 1,00/1,50
## Verificação de jurisprudência e citações
- Artigos conferidos no texto oficial.
NOTA SUGERIDA: 8,00/10
## Propostas de aprimoramento
- Desenvolver a tese e indicar o dispositivo correspondente, sem copiar texto pronto. A análise deve permanecer orientativa e explicar os critérios ao estudante com clareza suficiente para a revisão humana pelo professor.
## Fontes e links
- [CPP](https://www.planalto.gov.br/ccivil_03/decreto-lei/del3689compilado.htm)`;
assert.equal(validarCorrecao(correcao).ok, true, 'correção consistente deve passar');
assert.equal(validarCorrecao(correcao.replace('NOTA SUGERIDA: 8,00/10', 'NOTA SUGERIDA: 7,00/10')).ok, false, 'nota divergente da soma deve falhar');
assert.equal(validarCorrecao(correcao.replace('- Artigos conferidos no texto oficial.', '- Súmula 9999 — INEXISTENTE/FALSA.')).ok, false, 'citação falsa exige nota zero');

console.log('OK: contratos determinísticos de IA, espelho e correção');
