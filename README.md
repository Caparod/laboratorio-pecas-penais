# Laboratório de Peças Penais - Render/Supabase

A chave de IA fica apenas no servidor, pela variável `ANTHROPIC_API_KEY`. O navegador dos alunos e professores nunca recebe essa chave.

## Publicação no Render

1. Crie um Web Service no Render apontando para esta pasta.
2. Use:
   - Runtime: Node
   - Build Command: `npm ci`
   - Start Command: `npm start`
3. Configure as variáveis de ambiente:
   - `ANTHROPIC_API_KEY`: chave da Anthropic.
   - `APP_URL`: URL pública do sistema no Render.
   - `MODELO_POTENTE`: modelo usado obrigatoriamente na geração de enunciados, gabaritos, pareceres pedagógicos e correções. Padrão: `claude-opus-4-8`.
   - `MODELO_OCR`: opcional, usado somente para transcrever fotos; padrão `claude-sonnet-5`.
   - `MODELO_CASO`: opcional, usado apenas em extrações mecânicas auxiliares de documentos administrativos; não participa da geração jurídica avaliativa.
   - `CREDITO_MENSAL_USD`: crédito de API renovado a cada mês, sem acúmulo. Padrão: `100`.
   - `PROF_LOGIN`: login do administrador principal.
   - `PROF_SENHA`: senha inicial forte do administrador principal. É obrigatória ao criar uma base nova.
   - `GMAIL_USER` e `GMAIL_APP_PASSWORD`: opcionais, para avisos por e-mail.
   - `SESSAO_DIAS`: opcional; na implantação fornecida, 7 dias.
   - `CONFIAR_PROXY`: `true` no Render. As rotas autenticadas de IA são limitadas por usuário, evitando bloquear toda a rede da instituição.
   - `CRIAR_CONTAS_DEMO`: mantenha `false` em produção. Use `true` somente nos testes automatizados.
   - `FATOR_MANUTENCAO` e `ASSINATURA_MENSAL_USD`: opcionais; padrões `1` e `0`. Quando usados, aparecem explicitamente no painel de custos.

## Supabase

O sistema usa Supabase como banco principal quando as variáveis abaixo existem. O arquivo `db.json` continua sendo salvo como contingência local. Se o Supabase estiver configurado e a leitura remota falhar, o serviço não inicia e não sobrescreve o estado remoto com um fallback local.

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

-- O estado completo da aplicação é privado. O backend usa a service_role,
-- que não é afetada pelo RLS; nenhuma política pública deve ser criada.
alter table public.app_state enable row level security;
revoke all on table public.app_state from anon, authenticated;
```

Se a tabela já existe, execute ao menos os dois últimos comandos no SQL Editor.
Como a leitura e a escrita são feitas pelo servidor com `SUPABASE_SERVICE_ROLE_KEY`, não exponha essa chave no front-end.

## Contas e senhas iniciais

- Somente o administrador definido por `PROF_LOGIN`/`PROF_SENHA` é criado em uma base nova.
- Novos professores e alunos recebem senha temporária aleatória, exibida uma única vez à coordenação.
- As contas `Any` e `Karine` com credenciais conhecidas existem somente quando `CRIAR_CONTAS_DEMO=true`.

## Proteções incluídas

- Acesso de professores limitado às próprias turmas, exceto administração/coordenação; apenas autor, administração ou coordenação podem editar o conteúdo de uma peça.
- Enunciados, gabaritos e correções gerados por IA só são aceitos completos. Truncamentos, recusas, estruturas ausentes e notas inconsistentes são descartados.
- O espelho é analisado item a item e precisa somar exatamente 5,00; a auditoria jurídica por fontes oficiais é obrigatória e falha de forma bloqueante.
- Cada alteração de caso/gabarito cria uma versão. Toda entrega conserva uma fotografia do caso e do gabarito que o aluno recebeu.
- Gabaritos antigos incompatíveis são sinalizados como “revisão obrigatória”, não são liberados aos alunos e não podem ser usados pela correção automática até serem revisados.
- Um aluno pode participar de várias turmas e recebe as peças de todas elas; remover/zerar uma turma preserva sua conta quando houver outro vínculo.
- Professor(a) pode zerar somente as turmas em que leciona; coordenação pode zerar qualquer turma e apenas a administração pode zerar o sistema inteiro.
- Ao zerar uma turma, vínculos, peças, entregas e notas dela são apagados; contas sem outra turma também são removidas, mas o cadastro da turma e seus professores são preservados.
- Aluno(a) só visualiza e entrega peças das turmas das quais participa.
- No primeiro acesso, o aluno precisa trocar a senha, cadastrar WhatsApp e cadastrar e confirmar o e-mail antes de acessar as demais APIs; troca/reset de senha invalida sessões antigas.
- Logout encerra a sessão também no servidor. O navegador usa cookie `HttpOnly`, e somente o hash dos tokens é persistido.
- Login possui limitação de tentativas e mensagens que não revelam se uma conta existe.
- Exclusões removem entregas, liberações e sessões relacionadas, evitando dados órfãos.
- Respostas incluem cabeçalhos de proteção do navegador e não armazenam dados de API em cache.
- A persistência local usa gravação temporária, cópia de segurança `db.json.bak` e substituição atômica.
- Falhas temporárias de escrita no Supabase são repetidas com espera progressiva.
- Integrações HTTP e SMTP possuem tempo limite.
- A leitura de PDF usa PDF.js 6.2.108 com avaliação dinâmica e scripting desativados (`isEvalSupported: false`, `enableScripting: false`), e o envio de e-mail usa Nodemailer 9.0.3.
- Alunos podem importar peças em PDF, DOCX ou DOC (até 6 MB). O texto é extraído para conferência e edição; o sistema registra nome, tipo, tamanho e hash do arquivo sem inflar o banco com uma cópia binária.
- O parecer inicial do aluno usa apenas o enunciado e a própria resposta, nunca recebe o gabarito, não atribui nota e não substitui a validação do professor. Ele procura citações não confirmadas, indícios de alucinação, prompts residuais, robotização sem supervisão humana e riscos jurídicos graves. Depois do parecer, o aluno decide expressamente entre enviar a versão ou refazê-la sem envio.
- O parecer e a correção final verificam simetria artificial, enumerações excessivas, uniformidade entre parágrafos/tópicos e linguagem formulaica. Esses sinais são tratados como indícios, nunca como prova automática de autoria por IA ou fundamento isolado para penalização.
- O uso de IA exige ciência do aviso de privacidade; consulte `privacidade.html` e `PRIVACIDADE.md`.
- CSV de notas tratado para reduzir risco de fórmula maliciosa no Excel.
- Prazos calculados em horário de Brasília.

## Recursos pedagógicos

- Painel por turma com entregas, correções, médias, evolução dos alunos e aproveitamento por critério quando o relatório contém pontuação item a item.
- Classificação opcional das peças por classe, assunto, documento, fase processual e órgão de referência, conforme as Tabelas Processuais Unificadas do CNJ.
- Acesso direto ao Banco Nacional de Precedentes (BNP) nas telas de gabarito e correção.
- Exportação das notas validadas por turma em CSV.

## Observação

No plano Free do Render o serviço pode dormir após inatividade; a primeira visita após pausa pode demorar cerca de 1 minuto.

Antes de uma aula, confirme no painel que não existem peças com o status “revisar gabarito” e execute `npm test` no pacote que será implantado. A publicação exige gabarito válido e prazo definido.
