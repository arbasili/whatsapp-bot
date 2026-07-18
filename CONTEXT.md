# Clique e Fecha — Bot de Vendas WhatsApp

**Versão atual:** `1.18.0` (2026-07-18)
**Arquivo principal:** `index.js` (~4.200 linhas, arquivo único) + `config-cliente.js` (identidade/oferta/agenda por cliente) + `heuristicas.js` (heurísticas puras testáveis)

---

## Objetivo do Projeto

Bot de qualificação de leads no WhatsApp que se apresenta como **"Lucas"**, um atendente do time da Clique e Fecha — empresa que vende automação de atendimento (chatbots) para pequenos negócios.

O bot conduz uma conversa consultiva no estilo SPIN Selling para:
1. Entender o negócio do lead e como ele atende hoje
2. Identificar a dor principal (demora, perda de cliente, atendimento manual)
3. Propor e agendar um **diagnóstico gratuito de 30 minutos** com um especialista humano, via Google Meet (a palavra "consultoria" foi aposentada em todo o produto — bot e painel falam "diagnóstico")
4. Gerenciar toda a jornada pós-agendamento: lembretes, confirmação de presença, remarcação e no-show
5. Recuperar leads que esfriaram, com follow-up e reativação
6. Alimentar um **painel CRM** com dados de qualificação, funil de vendas e inteligência de IA sobre cada lead

O bot é vendido pela própria empresa como demonstração viva do produto: a experiência de conversar com o Lucas é o que a Clique e Fecha quer vender para os clientes dela.

---

## Regras de Negócio

### Fluxo de conversa (roteiro do Lucas)
1. **Boas-vindas** em 3 partes (saudação, apresentação, pergunta do nome), separadas pelo marcador `|||`
2. **Entender a operação** — "Me conta sobre a sua operação, o que você faz?"
3. **Entender o processo atual no WhatsApp** — "E hoje, como funciona o seu atendimento com os clientes no WhatsApp?"
4. **Qualificar contexto** — se já tentou resolver antes (opcional, só se fluir naturalmente)
5. **Aumentar a dor (implicação)** — no máximo uma pergunta, só se a dor ainda não estiver clara; usa `|||` para separar observação empática da pergunta
6. **Ponte + proposta de reunião** — conecta a dor específica do lead (com as palavras dele) à solução, depois oferece a reunião; separado em 2 partes com `|||`
7. **Escolha de horário** — duas opções (manhã e tarde), sempre em horário de Brasília
8. **Confirmação de WhatsApp** — leve, não bloqueia o fluxo ("Vou usar esse número mesmo pra contato, tá?")
9. **Captura e confirmação de email** — pede o email e confirma de volta antes de agendar ("Anotei aqui: [email]. Tá certinho?")
10. **Sistema cria o evento** no Google Calendar, gera link do Meet e envia confirmação

### Regras de linguagem (aplicam-se a toda mensagem)
- **Proibido travessão (—)** em qualquer hipótese
- Voz leve de WhatsApp: "tô", "tá", "pra", "pro" — sem gírias pesadas
- **Máximo 1 emoji por mensagem**, sempre ao final como pontuação de reação curta — nunca no meio da frase, nunca com dados (número, email, agendamento)
- **Uma pergunta por mensagem** — regra absoluta
- Mensagens curtas (1-2 parágrafos)
- **Nunca inventar** preços, descontos, prazos, clientes ou cases
- Negrito só com asterisco simples, nunca em dado pessoal
- **Nunca repetir a mesma expressão de validação** ("Faz sentido", "Pô") em mensagens próximas — "Pô" é proibido definitivamente

### Tratamento de objeções
- "Agora não" / "Não tenho tempo" → investiga motivo, oferece flexibilidade de horário
- "Está caro" / "Quanto custa?" → valida a pergunta, enquadramento qualitativo sem inventar valores
- "Já tenho alguém" → respeita, explora se está satisfeito
- "Vou pensar" → sem opção de fuga; oferece horário reservado sem compromisso
- "Preciso falar com meu sócio" → valida, oferece trazer a pessoa para a reunião
- "Como funciona? / Quanto tempo de implementação?" → resposta curta e concreta

### Desqualificação e de-escalação
- **Desqualificação elegante**: se o lead não tem fit (curioso, sem negócio, fora do público), o bot não insiste — reconhece com leveza e deixa a porta aberta
- **De-escalação**: se o lead demonstra irritação ou hostilidade, o bot não fica defensivo, reconhece o incômodo e oferece passar direto ao especialista; se pedir para parar, confirma e encerra

### Fast-track e reconhecimento de contexto
- **Fast-track**: lead com intenção clara de compra ("quero contratar", "como faço pra começar") pula a qualificação completa e vai direto para nome + agendamento
- **Não repete perguntas já respondidas**: se o lead já contou tipo de negócio e dor na primeira mensagem, o bot não repete essas perguntas
- **Retorno de lead**: reconhece quando já conversou antes, não recomeça do zero
- **Retorno após no-show**: reconhece o contexto e abre espaço para remarcar sem cobrar explicação
- **Origem do lead** (Site, Instagram, Indicação, Anúncio, WhatsApp direto) é usada para personalizar a abertura

### Cadência de follow-up (dentro da janela de 24h da Meta)
- Follow-up 1: 4h após última mensagem do lead
- Follow-up 2: 22h após última mensagem (última chance dentro da janela)
- São só **2 toques** — o toque intermediário de 6h foi removido por risco à reputação do número
- Após 24h sem resposta: janela fecha, lead vai para reativação (que hoje **falha silenciosamente** sem templates aprovados da Meta — ver Pendências)

### Reativação de leads encerrados
- 3 dias sem resposta → mensagem de reativação citando o negócio do lead
- 7 dias sem resposta → segunda mensagem, reconhecendo que o timing pode ter sido ruim
- Após mais tempo sem resposta → status `Perdido sem resposta`, notifica o especialista

### Lembretes pós-agendamento
- 24h antes: confirma presença, cita o negócio do lead
- 2h antes: lembrete + envio automático de brief de preparação para o especialista
- 30min antes: envia o link do Meet
- No-show detectado 30-90min após o horário marcado, com mensagem de reengajamento

### Horário de silêncio
- 20h às 8h (horário de Campo Grande): **só bloqueia lembretes automáticos**
- **Nunca bloqueia resposta a mensagens do lead** — o bot responde 24/7, essa é uma premissa central do produto

### Funil de vendas (12 etapas + saídas)
Campo `status` mostra a etapa atual (sobrescreve). Campo `funnel_stages` acumula siglas em ordem, nunca apaga.

| Etapa | Sigla | Quem aplica |
|-------|-------|-------------|
| Em conversa | `[EM]` | Bot |
| Qualificando | `[QA]` | Bot |
| Pronto para agendar | `[PA]` | Bot |
| Reunião agendada | `[RA]` | Bot |
| Reunião realizada | `[RR]` | Manual |
| Proposta | `[PR]` | Manual |
| Negociação | `[NG]` | Manual |
| Fechado e Venda | `[FV]` | Manual |
| Fechado e Perdido | `[FP]` | Manual (só após reunião) |
| No-show | `[NS]` | Bot |
| Remarcando | `[RM]` | Bot |
| Encerrado sem agendar | `[ES]` | Bot |
| Reativação 3 dias | `[R3]` | Bot |
| Reativação 7 dias | `[R7]` | Bot |
| Perdido sem resposta | `[PS]` | Bot (antes da reunião) |

### Temperatura do lead
Calculada no momento do agendamento (e parcialmente no encerramento), cruzando urgência, dor e engajamento:
- **Quente**: urgência imediata ou dor com perda de cliente ativa
- **Morno**: urgência nos próximos dias, ou lead engajado (4+ mensagens)
- **Frio**: sem urgência clara ou urgência distante

---

## Decisões Técnicas

### Stack
- **Node.js 20 + Express** — servidor principal
- **Claude** (`CLAUDE_MODEL`, padrão `claude-sonnet-5`) — IA que conduz toda a conversa e gera insights
- **WhatsApp Business API (Meta)** — canal de comunicação
- **Google Calendar + Meet** — agendamento de reuniões
- **PostgreSQL (Railway)** — persistência de estado e dados de CRM
- **Supabase Auth** — autenticação JWT do painel CRM
- **Groq Whisper** — transcrição de áudio (opcional)

### Bibliotecas (package.json)
`@supabase/supabase-js`, `axios`, `cors`, `dotenv`, `express`, `form-data`, `googleapis`, `pg`, `ws` (necessário para o Supabase funcionar em Node 20+)

### Arquitetura
- Arquivo único `index.js` — decisão consciente por simplicidade no estágio atual do produto; modularização fica para quando o volume justificar
- Estado quente (conversas ativas, follow-ups, agendamentos) mantido em memória (objetos JS) e persistido no Postgres a cada mudança
- SaaS multi-cliente: toda tabela tem `client_id`, cliente auto-registrado no boot via `CLIENT_ID`/`CLIENT_NAME`/`CLIENT_EMAIL`

### Estrutura do banco (ordem de criação importa — `clients` primeiro)
- **clients** — cadastro de clientes da plataforma
- **user_clients** — vínculo usuário Supabase ↔ cliente (autorização multi-tenant; coluna `role`, padrão `admin`)
- **bot_state** — estado de runtime por lead (conversas, follow-ups, agendamentos)
- **leads** — CRM completo: dados de qualificação, funil, temperatura, score, insights de IA, notas, timestamps, `deleted_at` (lixeira)
- **conversations** — histórico de mensagens formatado para o painel (`messages JSONB`)
- **ai_activity** — feed de ações da IA para a visão geral do painel
- **tasks** — tarefas do vendedor (manuais e geradas pelo bot, ex.: motivo de cancelamento)
- **lead_notes** — log de anotações do vendedor por lead
- **client_settings** — configurações do painel em JSONB (metas por competência)
- **opt_outs** — leads que pediram pra não receber mais mensagens (excluir lead ≠ opt-out)

Todas as colunas novas usam `ALTER TABLE ADD COLUMN IF NOT EXISTS` para migração automática no boot, sem necessidade de scripts manuais.

### Segurança
- SSL do Postgres: `rejectUnauthorized: false` para conexão externa do Railway (certificado auto-assinado do provedor) e `false` (sem SSL) para conexão interna `railway.internal`
- Validação de assinatura de webhook da Meta (`META_APP_SECRET`)
- Autenticação JWT via Supabase em todas as rotas `/api/*`
- `MEU_NUMERO` movido de hardcoded no código para variável de ambiente
- `limit` e `offset` validados nas rotas de listagem (evita erro 500 e abuso)

### Robustez
- **Lock por telefone** (`processarComLock`) — `Map<phone, Promise>` encadeia o processamento de mensagens do mesmo lead, eliminando corrida de condição quando duas mensagens chegam quase simultâneas
- **Corte de histórico seguro** — ao truncar conversas longas para enviar ao Claude, descarta mensagens `assistant` do início da cauda para nunca gerar duas mensagens `assistant` seguidas (que a API rejeitaria com erro 400)
- **Mídia assíncrona** — imagem e áudio respondem `200` ao webhook da Meta imediatamente e processam via `setImmediate`, evitando timeout e possível desabilitação da integração
- **Deduplicação de webhook** via `Set` de mensagens processadas
- **Rate limiting** por telefone
- **Debounce de 4s** para agrupar mensagens enviadas em sequência rápida antes de processar
- Locks anti-sobreposição nos jobs (`followUpRodando`, `lembretesRodando`, `reativacaoRodando`)
- Retry com backoff exponencial nas chamadas à API da Anthropic (até 3 tentativas)
- Validação de variáveis de ambiente obrigatórias no boot (falha cedo e claro)

### Logs estruturados
Todas as chamadas ao Claude (conversa principal, resumo, score, follow-up) logam tempo de resposta e tokens consumidos, no formato:
```
[Claude] 1243ms | input: 1847 tokens | output: 89 tokens | msgs enviadas: 12
```

---

## Funcionalidades Implementadas

- Roteiro consultivo completo com marcadores internos (`[NOME:]`, `[SLOT:]`, `[VERIFICAR_DATA:]`, `[ENCERRAR]`) e separador de mensagens (`|||`)
- Agendamento automático no Google Calendar com geração de link do Meet
- Remarcação (limite de 2 vezes) e detecção de no-show
- Cadência de follow-up dentro da janela de 24h da Meta
- Job de reativação automática (3 e 7 dias) para leads que esfriaram
- Suporte a texto, imagem e áudio (transcrito via Groq Whisper)
- Reação de emoji do lead é ignorada silenciosamente (não gera resposta)
- Detecção de origem do lead (Site, Instagram, Indicação, Anúncio, WhatsApp direto)
- Cálculo de temperatura do lead (quente/morno/frio)
- **Inteligência de IA por lead**: score (0-100), probabilidade de fechamento, próxima ação sugerida, insights, objeção principal, recomendações e resumo em bullets — calculado no agendamento (completo) e no encerramento por inatividade (parcial)
- Brief automático de preparação enviado ao especialista 2h antes de cada reunião (dados do lead, dor, temperatura, score, objeção)
- Gravação incremental de nome, tipo de negócio, dor e urgência conforme a conversa avança
- Histórico de conversa persistido na tabela `conversations` para exibição no painel
- Feed de atividade da IA (`ai_activity`) para a visão geral do painel
- Funil de vendas completo com 12 etapas + saídas, rastreado por siglas acumuladas
- API REST completa para o painel CRM:
  - `GET /api/leads` (filtros por status, temperatura, paginação)
  - `GET /api/leads/:id`
  - `PATCH /api/leads/:id/status` (movimentação manual no kanban, idempotente)
  - `PATCH /api/leads/:id/notes` (anotações do especialista)
  - `GET /api/leads/:id/conversation` (histórico de mensagens)
  - `GET /api/metrics` (métricas agregadas, funil completo, tempos médios, comparativo semanal)
  - `GET /api/activity` (feed de atividade da IA)
  - `GET /api/health` (heartbeat do bot)
  - `DELETE /api/leads/:id` (soft delete → lixeira 30 dias) / `POST /api/leads/:id/restaurar` / `DELETE /api/leads/:id/definitivo` (só de quem já está na lixeira; purge automático a cada 12h)
  - `GET /api/leads?excluidos=1` (conteúdo da lixeira)
  - `GET/PATCH /api/settings` (metas por competência em `client_settings`)
  - `GET /api/stream` (SSE — atualizações em tempo real pro painel, heartbeat de 15s)
- Remarcação direta em 1 balão (pedido de remarcar já responde com os novos horários)
- Captura do motivo de cancelamento: após cancelar, o bot pergunta o que pesou; a resposta vira tarefa concluída de origem `bot` no card do lead e avisa o especialista (cancelar ≠ negócio perdido — lead volta a "Pronto para agendar")
- CORS configurável via `CORS_ORIGINS` (múltiplas origens de painel)

---

## Pendências / Próximos Passos

### Concluído (v1.9.x — julho/2026)

- ✅ **Autorização real por cliente** — `verificarToken` agora valida o JWT **e** confirma o vínculo do usuário ao `CLIENT_ID` via tabela `user_clients` (com cache de 60s e bootstrap do primeiro acesso). O agente-reunioes usa o mesmo mecanismo.
- ✅ **Prompt caching** — roteiro vai no parâmetro `system` com `cache_control: ephemeral`; contexto dinâmico (saudação/horários/estágio do funil) num bloco separado que não invalida o cache.
- ✅ **Rate limit e Helmet nas rotas `/api/*`** — `express-rate-limit` (120 req/min por IP) + Helmet, com `trust proxy` para o Railway.
- ✅ **Redação de PII nos logs** — telefone sempre mascarado (`mascararTelefone` → `***1234`); conteúdo de mensagem redigível via `LOG_CONTEUDO=false`.
- ✅ **Testes unitários das heurísticas** — `heuristicas.test.js` (59 testes, `npm test`) cobrindo `escolherSlot`, `extrairNomeLead`, `extrairTipoNegocio`, `extrairDorLead`, `extrairUrgencia`, `interpretarRespostaEmail`, `mesclarTurnosConsecutivos`, intenção de compra e opt-out. **Sempre rodar antes de commit.**
- ✅ **Modularização (parcial)** — heurísticas puras extraídas para `heuristicas.js`; identidade/oferta por cliente extraída para `config-cliente.js`.

### Concluído (v1.10–v1.18 — julho/2026)

- ✅ **Consultoria → Diagnóstico** — rename em todo o produto (prompt, regexes, painel).
- ✅ **Regra global de 1 pergunta por mensagem** + trava explícita na abertura (a saudação termina em "Posso te chamar de X?").
- ✅ **Remarcação em 1 balão** e **captura do motivo de cancelamento** (vira tarefa concluída no lead).
- ✅ **Exclusão de leads padrão ouro** — soft delete (`deleted_at`) + lixeira 30 dias no painel + exclusão definitiva em 2 etapas + purge automático 12h + renascimento se o lead voltar a escrever. Isso cobre a antiga pendência de "rota de exclusão de dados (LGPD)".
- ✅ **Onboarding de cliente** — `criar-cliente.js` (cria cliente, convida usuário no Supabase, vincula `user_clients`) + checklist do que continua manual; bootstrap automático do primeiro usuário foi **removido** (BOT-004) — vínculo só via script.
- ✅ **Coluna `role` em `user_clients`** (padrão `admin`) — alicerce de permissões, sem enforcement ainda.
- ✅ **Seed com sufixo "(teste)"** nos nomes (`seed-leads.js`) + `limpar-leads-teste.js` — leads reais vindos do link público do Instagram ficam distinguíveis.

### Ainda pendente

- **Templates de mensagem da Meta (BOT-001) — o único furo real de produção**: fora da janela de 24h, follow-up/reativação falham com erro 131047 e a mensagem nunca chega. Precisa criar e aprovar templates no gerenciador da Meta e ensinar o bot a usá-los quando a janela fechar.
- **Logger estruturado** (ex: Pino) — hoje é `console.log`/`console.error` com mascaramento manual; falta logging estruturado de verdade.
- **Estado quente em Redis** — `conversas`, `agendamentosConfirmados` e afins ainda vivem em memória do processo, o que impede múltiplas instâncias e perde o dedup de webhook em restart.
- **Buscar nome/número do vendedor dinamicamente do CRM** — `MEU_NUMERO` ainda é fixo via env var (só um vendedor); quando houver cadastro de múltiplos vendedores no painel, deve vir de lá.
- **Teste unitário de `interpretarPedidoData`** — segue sem cobertura (depende do Google Calendar); as demais heurísticas já têm.
- **Modularização completa** — `index.js` ainda é um arquivo único grande; considerar dividir em serviços (`whatsapp.js`, `claude.js`, `calendar.js`) quando a manutenção justificar.
- **`DB_CA_CERT` no Railway** — enquanto não configurado, a conexão Postgres pública fica em `rejectUnauthorized: false`. O código já suporta a variável (valida a CA quando presente); falta preencher no ambiente.
- **Reforçar captura de gatilhos emocionais fortes** — o espelhamento da consequência foi adicionado ao roteiro (v1.9.1), mas gatilhos específicos como "medo de perder para concorrência" podem ser mais explorados na ponte de proposta.

---

## Observações Importantes

- **Campo Grande (MS) é UTC-04:00 o ano todo**, sem horário de verão desde 2019. Brasília = Campo Grande + 1h. Essa conversão está correta hoje mas é uma suposição frágil caso a legislação de fuso mude.
- **O bot é a vitrine do produto**: toda decisão de UX (ritmo, silêncios, tom de voz) parte do princípio de que a experiência de conversar com o Lucas é a melhor demonstração do que a empresa vende. Isso motivou a redução de pausas artificiais de 10s para 1,5-3s e a unificação da voz entre mensagens geradas pela IA e mensagens automáticas fixas.
- **Credibilidade sem clientes**: como a empresa está começando, o roteiro nunca inventa cases ou depoimentos — usa o próprio atendimento como prova viva, a figura do especialista humano e o enquadramento de "primeiras parcerias" como vantagem (atenção total ao lead).
- **O link público do Instagram traz gente real conversando com o bot** — por isso todo lead de seed/teste carrega "(teste)" no nome; nunca assuma que um lead sem esse sufixo é fake.
- **Versão**: `BOT_VERSION` no topo do `index.js`, conferida via `/health` após cada deploy. Nunca bumpar com `sed` (falha silenciosa já enviou 5 releases com versão velha) — Edit + grep de verificação antes do commit.
- **Painel CRM é um projeto separado**, desenvolvido em outro chat/repositório (`painel-clique-fecha`), que consome a API do bot via JWT do Supabase. Documentos de atualização (`CONTEXT.md`, `UPDATES_CRM.md`) são gerados neste chat sempre que uma mudança no bot afeta o que o painel precisa exibir ou consumir.
- **Testes de conversa real via WhatsApp** foram usados extensivamente ao longo do desenvolvimento para validar tom, fluidez e pontos de fricção — não apenas testes automatizados de código. Boa parte das 18 melhorias de produto vieram de análise de prints de conversas reais.
