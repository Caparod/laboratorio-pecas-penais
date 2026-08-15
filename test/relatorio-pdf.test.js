'use strict';
const assert = require('assert');
const fs = require('fs');
const { gerarPdfEspelho, gerarPdfParecerInicial, relatorioParaHtml, linhasEspelho, extrairTabelaMarkdown } = require('../relatorio-pdf');

const relatorio = `## Acertos
- O cabimento, o endereçamento e a tese principal foram apresentados de acordo com o padrão de resposta.
## Erros formais
- O fechamento não indicou de forma completa local, data e assinatura.
## Erros materiais (direito)
- A tese subsidiária não foi relacionada integralmente ao dispositivo aplicável e aos fatos do enunciado.
## Pontuação item a item — espelho OAB/FGV
| Item | Critério avaliado | Pontos obtidos/possíveis | Justificativa detalhada |
|---|---|---:|---|
| 1 | Cabimento e endereçamento | 1,00/1,00 | A peça e o órgão destinatário correspondem ao gabarito. |
| 2 | Tempestividade e legitimidade | 0,50/0,50 | O prazo e a capacidade postulatória foram reconhecidos. |
| 3 | Fatos e síntese | 0,50/0,50 | A síntese preservou os fatos juridicamente relevantes. |
| 4 | Fundamentação e teses | 1,00/1,50 | A tese principal está correta, mas faltou aprofundar a subsidiária. |
| 5 | Pedidos | 0,50/0,75 | O pedido principal foi formulado; o subsidiário ficou incompleto. |
| 6 | Técnica, linguagem e forma | 0,50/0,75 | A redação é clara, com desconto pelo fechamento incompleto. |
## Verificação de jurisprudência e citações
- Os dispositivos citados foram conferidos em fonte oficial.
## Verificação de robotização e supervisão humana
- Risco BAIXO. Não há evidência suficiente para concluir produção automatizada sem revisão.
## Rastreabilidade dos descontos
| Falha identificada | Aplicação | Desconto |
|---|---|---:|
| Fechamento formal incompleto | Desconto aplicado no próprio item do espelho | 0,25 |
| Tese subsidiária insuficiente | Desconto aplicado no próprio item do espelho | 0,50 |
TOTAL DE PENALIDADES FORA DO ESPELHO: 0,00
NOTA SUGERIDA: 4,00/5
## Propostas de aprimoramento
- Relacionar cada tese aos fatos, explicitar os pedidos subsidiários e conferir todos os elementos do fechamento formal.
## Fontes e links
- Código de Processo Penal: https://www.planalto.gov.br/ccivil_03/decreto-lei/del3689compilado.htm`;

const dados = { aluno: 'Maria da Silva', matricula: '20260001', turma: 'Estágio II - Turma A', rodada: 1, nomePeca: 'Apelação Criminal', nota: 4, data: '09/08/2026 14:30:00', relatorio, recurso: { resultado: 'Deferido parcialmente', notaAnterior: 3.75, decisao: 'O item de fundamentação foi revisto parcialmente; os demais descontos foram mantidos segundo o espelho.' } };
const pdf = gerarPdfEspelho(dados);
assert.equal(pdf.subarray(0, 8).toString('ascii'), '%PDF-1.4');
assert.ok(pdf.length > 5000, 'PDF deve conter o espelho completo');
assert.ok(linhasEspelho(relatorio.split('\n')).length >= 6, 'tabela deve ser convertida em itens');
const linhaComSumulas = linhasEspelho(['| 4 | Regime prisional — Súmulas 718/719 do STF | 0,60/0,60 | Regime corretamente fundamentado. |'])[0];
assert.equal(linhaComSumulas.obtido, '0,60', 'números de súmulas não podem ocupar a coluna de pontos obtidos');
assert.equal(linhaComSumulas.maximo, '0,60', 'números de súmulas não podem ocupar a coluna de pontuação máxima');
const rastreabilidade = extrairTabelaMarkdown(relatorio.split('## Rastreabilidade dos descontos')[1].split('## Propostas')[0].split('\n'));
assert.deepEqual(rastreabilidade.cabecalho, ['Falha identificada', 'Aplicação', 'Desconto']);
assert.equal(rastreabilidade.linhas.length, 2, 'tabela de rastreabilidade deve ser reconhecida fora da seção de pontuação');
const html = relatorioParaHtml(dados);
assert.match(html, /formato OAB\/FGV/i);
assert.match(html, /Resultado do recurso/i);
assert.match(html, /<th[^>]*>Falha identificada<\/th>/i, 'rastreabilidade deve aparecer como tabela real no relatório HTML');
assert.doesNotMatch(html, /\|\s*Falha identificada\s*\|/, 'marcadores markdown da tabela não podem aparecer para o aluno');
const pdfParecer = gerarPdfParecerInicial({ aluno: 'Maria da Silva', matricula: '20260001', turma: 'Estágio II - Turma A', rodada: 1, nomePeca: 'Apelação Criminal', data: '11/08/2026 10:00:00', parecer: '## Visão geral\n- Confira a coerência entre os fatos narrados e os fundamentos apresentados.\n## Próximo passo\n- Revise os pontos indicados antes de decidir o envio.' });
const parecerLatin1 = pdfParecer.toString('latin1');
assert.equal(pdfParecer.subarray(0, 8).toString('ascii'), '%PDF-1.4');
assert.ok(pdfParecer.length > 1500, 'PDF deve conter o parecer de pré-correção');
assert.match(parecerLatin1, /PARECER DE PRÉ-CORREÇÃO/i, 'parecer precisa ter título próprio');
assert.match(parecerLatin1, /TRIAGEM PEDAGÓGICA - SEM NOTA/i, 'parecer precisa declarar que não atribui nota');
assert.doesNotMatch(parecerLatin1, /NOTA FINAL/i, 'pré-correção não pode exibir nota final');
if (process.env.PDF_AMOSTRA) fs.writeFileSync(process.env.PDF_AMOSTRA, pdf);
if (process.env.PDF_PARECER_AMOSTRA) fs.writeFileSync(process.env.PDF_PARECER_AMOSTRA, pdfParecer);
console.log('OK: espelho OAB/FGV em PDF e HTML validado.');
