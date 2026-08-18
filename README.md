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
   - `ANTHROPIC_BATCHES_ATIVO`: usa a Message Batches API nas correções comuns em Sonnet, sem pesquisa web, com 50% de desconto nos tokens. Casos de alto risco, Opus e pesquisa oficial seguem em uma segunda fase sequencial, com reserva por chamada. Padrão: `true`. Use `false` para manter todo o fluxo sequencial.
   - `APP_URL`: URL pública do sistema no Render.
   - `MODELO_GERACAO`: geração inicial de enunciados. Padrão: `claude-sonnet-5`; a auditoria jurídica continua separada no modelo de auditoria.
   - `MODELO_PRECORRECAO`: pré-correção obrigatória do aluno. Padrão: `claude-sonnet-5`; saída inválida passa por reparo e, se necessário, escalonamento ao modelo de auditoria antes da contingência determinística.
   - `MODELO_CORRECAO`: primeira correção de entregas comuns. Padrão: `claude-sonnet-5`; casos de alto risco e falhas persistentes usam o modelo de auditoria.
   - `MODELO_GABARITO`, `MODELO_AUDITORIA` e `MODELO_RECURSO`: conteúdo jurídico de maior risco, auditorias e recursos. Padrão: `claude-opus-4-8`.
   - `MODELO_REPARO`: reparos estruturais sem nova pesquisa. Padrão: `claude-sonnet-5`.
   - `MODELO_OCR`: transcrição de fotos e extrações mecânicas. Padrão: `claude-haiku-4-5-20251001`.
   - `MODELO_POTENTE`: fallback compatível para as variáveis de gabarito, auditoria e recurso quando elas não forem configuradas. Padrão: `claude-opus-4-8`.
   - `MODELO_CASO`: extrações mecânicas auxiliares de documentos administrativos. Padrão: `claude-haiku-4-5-20251001`; não participa da geração jurídica avaliativa.
   - `LICENCA_MENSAL_USD`: licença institucional mensal — pagamento do autor pela disponibilização, manutenção e evolução do sistema. Padrão: `100`.
   - `ORCAMENTO_IA_MENSAL_USD`: teto mensal do custo bruto da API de IA. Padrão: `100`. A compatibilidade com o nome antigo `CREDITO_MENSAL_USD` é mantida quando a variável nova não estiver definida. Esse teto não inclui, não consome e não substitui a licença institucional.
   - `RESERVA_IA_PERCENTUAL`: reserva operacional aplicada somente sobre o custo real da API de IA. Padrão: `25` (25%).
   - `PRECO_WEB_SEARCH_USD`: preço por busca web contabilizada pela API. Padrão: `0.01`.
   - Os preços por milhão de tokens também podem ser atualizados sem alterar o código: `PRECO_OPUS_4_8_ENTRADA_MTOK_USD`/`PRECO_OPUS_4_8_SAIDA_MTOK_USD` (padrões `5`/`25`), `PRECO_HAIKU_4_5_ENTRADA_MTOK_USD`/`PRECO_HAIKU_4_5_SAIDA_MTOK_USD` (padrões `1`/`5`) e `PRECO_SONNET_5_ENTRADA_MTOK_USD`/`PRECO_SONNET_5_SAIDA_MTOK_USD` (padrões permanentes `2`/`10`).
   - `PROF_LOGIN`: login do administrador principal.
   - `PROF_SENHA`: senha inicial forte do administrador principal. É obrigatória ao criar uma base nova.
   - `GMAIL_USER` e `GMAIL_APP_PASSWORD`: opcionais, para avisos por e-mail.
- `SESSAO_DIAS`: opcional; limita a validade máxima da sessão no servidor (7 dias na implantação fornecida). O cookie de autenticação não é persistente e é descartado ao encerrar o navegador.
   - `CONFIAR_PROXY`: `true` no Render. As rotas autenticadas de IA são limitadas por usuário, evitando bloquear toda a rede da instituição.
   - `CRIAR_CONTAS_DEMO`: mantenha `false` em produção. Use `true` somente nos testes automatizados.
   - O painel financeiro preserva o histórico mensal e mostra separadamente custo real da API, reserva operacional de IA, uso de IA com reserva, licença institucional e total. Não existe multiplicador oculto. O painel também exibe consumo, chamadas em andamento, saldo e alertas de 70%, 85% e 100% do orçamento bruto.

## Supabase

O sistema usa Supabase como banco principal quando as variáveis abaixo existem. O arquivo `db.json` continua sendo salvo como contingência local. Se o Supabase estiver configurado e a leitura remota falhar, o serviço não inicia e não sobrescreve o estado remoto com um fallback local.

Variáveis no Render:

- `SUPABASE_URL`: URL do projeto Supabase.
- `SUPABASE_SECRET_KEY`: chave atual `sb_secret_...` do Supabase, recomendada. Use apenas no servidor.
- `SUPABASE_SERVICE_ROLE_KEY`: chave service role legada (JWT), mantida por compatibilidade. Use apenas no servidor.
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
Como a leitura e a escrita são feitas pelo servidor com uma chave privilegiada, não exponha `SUPABASE_SECRET_KEY` nem `SUPABASE_SERVICE_ROLE_KEY` no front-end.

## Contas e senhas iniciais

- Somente o administrador definido por `PROF_LOGIN`/`PROF_SENHA` é criado em uma base nova.
- Novos professores e alunos recebem senha temporária aleatória, exibida uma única vez à coordenação.
- As contas `Any` e `Karine` com credenciais conhecidas existem somente quando `CRIAR_CONTAS_DEMO=true`.

## Proteções incluídas

- Acesso de professores limitado às próprias turmas, exceto administração/coordenação; apenas autor, administração ou coordenação podem editar o conteúdo de uma peça.
- Enunciados, gabaritos e correções gerados por IA só são aceitos completos. Truncamentos, recusas, estruturas ausentes e notas inconsistentes são descartados.
- O espelho é analisado item a item e precisa somar exatamente 5,00; a auditoria jurídica por fontes oficiais é obrigatória e falha de forma bloqueante.
- Cada alteração de caso/gabarito cria uma versão. Fotografias imutáveis são deduplicadas por SHA-256: cada entrega aponta para a versão recebida sem repetir caso e gabarito por aluno. Referência ausente ou adulterada bloqueia a operação avaliativa.
- Gabaritos antigos incompatíveis são sinalizados como “revisão obrigatória”, não são liberados aos alunos e não podem ser usados pela correção automática até serem revisados.
- Um aluno pode participar de várias turmas e recebe as peças de todas elas; remover/zerar uma turma preserva sua conta quando houver outro vínculo.
- Professor(a) pode zerar somente as turmas em que leciona; coordenação pode zerar qualquer turma e apenas a administração pode zerar o sistema inteiro.
- Ao zerar uma turma, vínculos, peças, entregas e notas dela são apagados; contas sem outra turma também são removidas, mas o cadastro da turma e seus professores são preservados.
- Aluno(a) só visualiza e entrega peças das turmas das quais participa.
- No primeiro acesso, o aluno precisa trocar a senha, cadastrar WhatsApp e cadastrar e confirmar o e-mail antes de acessar as demais APIs; troca/reset de senha invalida sessões antigas.
- Logout encerra a sessão também no servidor. O navegador usa cookie de sessão `HttpOnly`, sem `Max-Age` ou `Expires`, e somente o hash dos tokens é persistido. Os dados de autenticação da interface ficam em `sessionStorage`, de modo que fechar a aba ou a janela exige novo login.
- Login possui limitação de tentativas e mensagens que não revelam se uma conta existe.
- Exclusões removem entregas, liberações e sessões relacionadas, evitando dados órfãos.
- Respostas incluem cabeçalhos de proteção do navegador e não armazenam dados de API em cache.
- A persistência local usa gravação temporária, cópia de segurança `db.json.bak` e substituição atômica.
- As gravações no Supabase passam por um único coordenador versionado: há no máximo um envio em andamento, estados pendentes são coalescidos sem regressão, gravações críticas aguardam sua própria revisão e snapshots idênticos não são reenviados.
- Integrações HTTP e SMTP possuem tempo limite.
- A leitura de PDF usa PDF.js 6.2.108 com avaliação dinâmica e scripting desativados (`isEvalSupported: false`, `enableScripting: false`), e o envio de e-mail usa Nodemailer 9.0.3.
- Alunos podem importar peças em PDF, DOCX ou DOC (até 6 MB). O texto é extraído para conferência e edição; o sistema registra nome, tipo, tamanho e hash do arquivo sem inflar o banco com uma cópia binária.
- O parecer inicial do aluno usa apenas o enunciado e a própria resposta, nunca recebe o gabarito, não atribui nota e não substitui a validação do professor. Ele procura citações não confirmadas, indícios de alucinação, prompts residuais, robotização sem supervisão humana e riscos jurídicos graves. Depois do parecer, o aluno decide expressamente entre enviar a versão ou refazê-la sem envio.
- A pré-correção nunca desaparece por falta de saldo e não pode ser contornada pela interface nem pela rota de entrega: quando o teto mensal da API é atingido, nenhuma nova chamada paga é iniciada e o aluno recebe um roteiro determinístico de contingência, persistido normalmente. Entregas externas registradas pelo professor recebem uma contingência administrativa identificada como não visualizada pelo aluno.
- O teto da API é concorrente e estrito: cada rodada paga reserva previamente uma estimativa conservadora e liquida o uso real ao terminar. Rejeições comprovadas liberam a reserva; timeout ou falha de rede com resultado incerto mantém uma pendência financeira até reconciliação explícita da administração. A licença institucional não entra nesse cálculo.
- O parecer e a correção final verificam simetria artificial, enumerações excessivas, uniformidade entre parágrafos/tópicos e linguagem formulaica. Esses sinais são tratados como indícios, nunca como prova automática de autoria por IA ou fundamento isolado para penalização.
- O uso de IA exige ciência do aviso de privacidade; consulte `privacidade.html` e `PRIVACIDADE.md`.
- A correção coletiva é híbrida: entregas comuns em Sonnet, sem busca, seguem como requisições independentes na Message Batches API; alto risco, Opus e pesquisa web são processados depois, um a um. O sistema persiste identificador, progresso e estado por item, retoma com segurança após reinícios e importa resultados por `custom_id`, mesmo fora de ordem. Cada resultado vira somente rascunho, nunca nota validada ou e-mail. Tokens elegíveis do lote usam fator `0,5`; itens sequenciais, reparos e escalonamentos usam o preço normal.
- Entradas e saídas de lotes assíncronos podem permanecer na Anthropic por até 29 dias. O sistema solicita a exclusão remota logo após a ingestão e repete a tentativa quando necessário; veja o aviso de privacidade atualizado.
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
