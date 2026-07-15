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
- Any: login `Any`, senha inicial `123456`, papel `Coordenadora do Curso de Direito`.
- Karine: login `Karine`, senha inicial `123456`, papel `Coordenadora do NPJ`.

## Proteções incluídas

- Acesso de professores limitado às próprias turmas, exceto administração/coordenação.
- Aluno só visualiza e entrega peças da própria turma.
- Sessões expiram após o prazo configurado.
- CSV de notas tratado para reduzir risco de fórmula maliciosa no Excel.
- Prazos calculados em horário de Brasília.

## Observação

No plano Free do Render o serviço pode dormir após inatividade; a primeira visita após pausa pode demorar cerca de 1 minuto.
