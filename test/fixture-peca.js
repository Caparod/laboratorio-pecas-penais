'use strict';

function casoTeste() {
  return 'Em 10/03/2026, a parte foi intimada de decisão criminal proferida pela Vara Criminal de Brasília. Em 16/03/2026, recebeu cópia integral dos autos, com depoimentos, laudos e fundamentação da decisão. O caso simulado descreve todos os fatos necessários e permite calcular o prazo processual sem dados externos. Na condição de advogado(a) da parte interessada, elabore a medida processual cabível, vedado o uso de habeas corpus. (Valor: 5,00)';
}

function gabaritoTeste(nome) {
  return `## Peça cabível
${nome}, com fundamento no Código de Processo Penal.
## Endereçamento
Ao juízo criminal competente.
## Prazo
Prazo indicado no enunciado.
## Teses principais e subsidiárias
Teses jurídicas pertinentes ao caso simulado.
## Pedidos
Conhecimento e provimento do pedido.
## Estrutura da peça — passo a passo
1. Endereçamento.
2. Fundamentação.
3. Pedidos.
## Espelho de correção
| Item | Pontuação |
|---|---:|
| Cabimento | 0,50 |
| Endereçamento | 0,50 |
| Fundamentação | 2,50 |
| Pedidos | 1,50 |
| **Total** | **5,00** |
## Erros frequentes esperados
Erro de cabimento ou prazo.
## Fontes
- [Código de Processo Penal](https://www.planalto.gov.br/ccivil_03/decreto-lei/del3689compilado.htm)`;
}

module.exports = { casoTeste, gabaritoTeste };
