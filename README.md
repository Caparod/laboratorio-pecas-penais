# Laboratório de Peças Penais - Render/Supabase

A chave de IA fica apenas no servidor, pela variável `ANTHROPIC_API_KEY`. O navegador dos alunos e professores nunca recebe essa chave.

## Publicação no Render

1. Crie um Web Service no Render apontando para esta pasta.
2. Use:
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
3. Configure as variáveis de ambiente:
   - `ANTHROPIC_API_KEY`: chave da Anthropic.
   - `APP_URL`: URL pública do sistema no Render.
   - `MODELO`: opcional, padrão definido no servidor.
   - `PROF_LOGIN`: login do administrador principal, se quiser mudar o padrão.
   - `PROF_SENHA`: senha inicial do administrador principal, se quiser mudar o padrão.
   - `GMAIL_USER` e `GMAIL_APP_PASSWORD`: opcionais, para avisos por e-mail.
   - `SESSAO_DIAS`: opcional, padrão 30.

## Supabase

O sistema usa Supabase como banco principal quando as variáveis abaixo existem. O arquivo `db.json` continua sendo salvo como contingência local.

Variáveis no Render:

- `SUPABASE_URL`: URL do projeto Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: chave service role do Supabase. Use apenas no servidor.
- `SUPABASE_STATE_TABLE`: opcional, padrão `app_state`.
- `SUPABASE_STATE_ID`: opcional, padrão `main`.

Crie a tabela no SQL Editor do Supabase:

```sql
create table if not exists public.app_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
```

Como a escrita é feita pelo servidor com `SUPABASE_SERVICE_ROLE_KEY`, não exponha essa chave no front-end.

## Contas padrão

- Administrador principal: definido por `PROF_LOGIN`/`PROF_SENHA`, ou o padrão legado do sistema.
- Any: login `Any`, senha inicial `123456`, papel `Coordenador(a) do Curso de Direito`.
- Karine: login `Karine`, senha inicial `123456`, papel `Coordenador(a) do NPJ`.

## Proteções incluídas

- Acesso de professores limitado às próprias turmas, exceto administração/coordenação.
- Professor(a) pode zerar somente as turmas em que leciona; coordenação pode zerar qualquer turma e apenas a administração pode zerar o sistema inteiro.
- Ao zerar uma turma, alunos, peças, entregas, notas e sessões dos alunos são apagados, mas o cadastro da turma e seus professores são preservados.
- Aluno(a) só visualiza e entrega peças da própria turma.
- Sessões expiram após o prazo configurado.
- CSV de notas tratado para reduzir risco de fórmula maliciosa no Excel.
- Prazos calculados em horário de Brasília.

## Recursos pedagógicos

- Painel por turma com entregas, correções, médias, evolução dos alunos e aproveitamento por critério quando o relatório contém pontuação item a item.
- Classificação opcional das peças por classe, assunto, documento, fase processual e órgão de referência, conforme as Tabelas Processuais Unificadas do CNJ.
- Acesso direto ao Banco Nacional de Precedentes (BNP) nas telas de gabarito e correção.
- Exportação das notas validadas por turma em CSV.

## Observação

No plano Free do Render o serviço pode dormir após inatividade; a primeira visita após pausa pode demorar cerca de 1 minuto.
