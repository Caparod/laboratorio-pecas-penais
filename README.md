# Laboratório de Peças Penais — versão para o Render

A chave da API NÃO fica no código: ela é lida da variável de ambiente `ANTHROPIC_API_KEY` no servidor.
O aluno acessa o site e o servidor faz a correção — ninguém consegue extrair a chave.

## Como publicar no Render (uma vez)

1. Crie uma conta em https://render.com (pode entrar com Google).
2. Suba esta pasta `render-app` (4 arquivos) para um repositório no GitHub (ou use "Deploy from Git" do Render).
3. No Render: **New → Web Service** → conecte o repositório.
   - Runtime: Node
   - Build Command: `npm install` (não há dependências — termina na hora)
   - Start Command: `npm start`
   - Plano: Free
4. Em **Environment → Add Environment Variable**:
   - `ANTHROPIC_API_KEY` = a chave criada no console da Anthropic (workspace Estagio-IESB, limite US$ 5/mês)
   - (opcional) `MODELO` = claude-sonnet-5
5. Deploy. O Render dá um endereço tipo `https://laboratorio-pecas.onrender.com` — é esse link que você passa aos alunos.

## Proteções incluídas
- Chave só no servidor (variável de ambiente).
- Limite de 8 correções por minuto por aluno (IP).
- Quando o limite mensal de créditos é atingido, o aluno vê: "LIMITE DE CRÉDITOS EXCEDIDO — avise o professor".
- Limite de gasto de US$ 5/mês configurado no console da Anthropic (camada extra de segurança).

## Observação
No plano Free do Render o serviço "dorme" após inatividade e a primeira visita do dia pode demorar ~1 min para carregar.
