# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install deps
npm start            # runs node index.js (no dev/watch script — restart manually after edits)
npm test             # node --test — runs heuristicas.test.js (unit tests for the text heuristics)
npm run check        # node --check index.js — syntax check only, no execution
npm run lint         # eslint . (no eslint config file present in the repo — will fail until one exists)
```

There is no build step; this is plain CommonJS Node.js run directly from `index.js`. The pure text-interpretation heuristics (`escolherSlot`, `extrairNomeLead`, `extrairTipoNegocio`, `extrairDorLead`, `extrairUrgencia`, `textoDoConteudo`) live in `heuristicas.js` so they can be unit-tested without booting the server — when changing them, run `npm test` and add cases for any new false-positive you fix.

Local `.env` is required to run (`cp .env.example .env` and fill in values) — the app calls `process.exit(1)` at boot if any required var is missing (see `ENV_OBRIGATORIAS` near the top of `index.js`).

## Architecture

This is the backend for the Clique e Fecha ecosystem: a **single-file Express app** (`index.js`, ~4200 lines, no internal module split) that (1) runs a WhatsApp conversational bot backed by Claude, and (2) exposes the REST API consumed by the separate `painel-clique-fecha` Next.js dashboard. There is no framework-level routing/service separation — everything (webhook handler, conversation engine, Google Calendar integration, Postgres access, CRM API routes) lives in this one file, organized by comment-banner sections and read top-to-bottom.

### Two request surfaces

1. **`GET/POST /webhook`** — Meta WhatsApp Business webhook. Verifies the HMAC signature (`validarAssinatura`, `META_APP_SECRET`) on every POST, dedupes repeated Meta deliveries by message id, then hands off to the conversation engine.
2. **`/api/*` routes** (near the end of `index.js`, under `─── ROTAS API CRM ───`) — consumed by the painel, protected by `verificarToken` (validates a Supabase JWT via `supabase.auth.getUser(token)`, using the **service role key**, distinct from the painel's anon-key client). CORS is locked to the painel's two known origins.

### Multi-tenancy

Every table (`clients`, `bot_state`, `leads`, `conversations`) carries a `client_id`, and this deployment is pinned to a single `CLIENT_ID` env var (one bot process = one tenant). `initDb()` auto-registers that `CLIENT_ID` into `clients` on boot if missing. All API queries and lead writes filter by `CLIENT_ID`; when adding a new query, always scope it by `client_id` like the existing ones. Per-client identity/offer/agenda config lives in `config-cliente.js` (one per deploy) — the mechanics in `index.js` are shared; onboarding a new client = `criar-cliente.js` + copy/fill `config-cliente.js` + new Railway service with its own env vars.

**`GET /api/leads` already supports `?limit=` (default 50, capped at 200) and `?offset=`** — pagination exists on this side. If the painel is only fetching the default 50 and appears to be missing leads, the fix is on the painel side (pass a higher `limit`/loop with `offset`), not here.

### Lead deletion (soft delete + trash)

Leads have a `deleted_at` column. `DELETE /api/leads/:id` soft-deletes (30-day trash, shown in the painel under Configurações → Dados); `POST /api/leads/:id/restaurar` undoes it; `DELETE /api/leads/:id/definitivo` hard-deletes but **only** leads already in the trash (2-step by design). `purgarLixeira()` runs every 12h and hard-deletes anything trashed >30 days ago (LGPD). **Every lead-listing/metrics query filters `deleted_at IS NULL`** — a new query that forgets this resurrects "deleted" leads in the UI. If a soft-deleted lead messages the bot again, `registrarLeadInicial`'s `ON CONFLICT ... WHERE leads.deleted_at IS NOT NULL` revives the row (deletion ≠ opt-out; opt-out is a separate table). The in-memory Pg cache (`leadsRegistradosPg`) must always be seeded from the real `leads` table, never inferred from `bot_state` — getting this wrong once caused leads to silently never re-register.

### Dual state model: in-memory + Postgres

Conversation/runtime state lives in **plain in-memory objects/Sets** (`conversas`, `ultimaMensagem`, `followUpStatus`, `agendamentos`, `agendamentosConfirmados`, `leadsAgendados`, `leadsEncerrados`) keyed by phone number, not directly in Postgres. `persistirLead(phone)` upserts a snapshot of that in-memory state into `bot_state` after basically every state change; `carregarLeads()` rehydrates all of it back into memory from `bot_state` on boot. This means:
- A restart is safe (state reloads from `bot_state`), but any code path that mutates the in-memory maps and forgets to call `persistirLead` will silently lose state on the next restart.
- `leads` (the CRM-facing table the painel reads) is a **separate, simplified table** updated via `atualizarLead()`/`registrarEtapaFunil()` — it is not the same data as `bot_state`. Conversation mechanics and CRM-facing lead data are intentionally decoupled.
- Being single-process/in-memory, this bot **cannot be horizontally scaled** without redesigning state storage — don't assume multiple instances can run concurrently against the same `CLIENT_ID`.

### Message pipeline (webhook → response)

1. Signature check → dedup by Meta message id → type dispatch (text/image/audio handled; other types get a canned reply).
2. Rate limiting per phone (`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS`).
3. Text messages are **debounced** (`DEBOUNCE_MS` = 4s) via `mensagensPendentes`/`debounceTimers` so rapid-fire messages from one user get batched into a single Claude call. Images/audio bypass debounce and are processed via `setImmediate` (to avoid Meta's webhook timeout) — audio goes through Groq Whisper transcription first (`transcreverAudio`).
4. `processarComLock(phone, ...)` serializes processing per phone through a promise chain (`filaProcessamento`) so overlapping messages for the same user never run `chamarClaude` concurrently — a single Claude turn can take up to ~25s.
5. `processarMensagem()` is the actual state machine: spam/prompt-injection heuristics, expiry/reactivation logic, first-message origin detection (site/Instagram/referral/ad, guessed from the WhatsApp deep-link prefill text), then either `tratarPosAgendamento()` (if the lead already has a confirmed meeting) or the general conversation path that calls `chamarClaude()`.
6. `chamarClaude()` sends the full message history (system prompt is the first entries in `conversas[phone]`, capped at the most recent 30 + header) to `POST /v1/messages`, with retry/backoff on 429/5xx.
7. After certain turns, `calcularInteligenciaLead()` makes a second, separate Claude call to produce `score`, `close_probability`, `next_action`, insights, objections, and `summary_bullets` — this is what feeds the painel's AI panels. It's triggered on scheduling and on give-up/reactivation, not on every message.

### Background jobs (all `setInterval`, in-process — no external scheduler/cron)

- **Reactivation** (hourly): leads marked `tentativas: 99` (a special sentinel meaning "in reactivation mode") get a 3-day then 7-day nudge message, then get marked `Perdido sem resposta` if still silent.
- **Follow-up** (every 15 min): drives leads through 4h/22h nudges (2 touches — the old 6h middle touch was removed as a number-reputation risk) within Meta's 24h free-messaging window, then transitions them into reactivation mode once the window closes — including leads that got zero follow-ups because the window closed while the bot was down.
- **Meeting reminders** (every 5 min): 24h/2h/30min-before reminders plus post-meeting no-show detection (30–90 min after `scheduled_at` with no confirmation).
- **bot_state cleanup** (daily): deletes `bot_state` rows untouched for 30 days with no confirmed meeting — without it, restarts re-hydrate leads that the in-memory expiry had already discarded. The CRM-facing `leads` table is never touched by this.
- All three guard against re-entrancy with a boolean flag (`reativacaoRodando`, `followUpRodando`, `lembretesRodando`) since a slow iteration could otherwise overlap the next tick.
- `dentroDoHorarioSilencio()` (20:00–08:00 America/Campo_Grande) suppresses *proactive/automated* messages (follow-ups, reactivation, 24h/2h reminders) except the 30-min pre-meeting reminder, which is considered too time-critical to delay. It never blocks replying to an inbound message from a lead — the bot responds 24/7 by design, since instant response is a core part of what the product demonstrates.

### Funnel model

`FUNIL` (near line 478) is the canonical map of pipeline stage → sigla tag (e.g. `EM_CONVERSA: '[EM]'`). `registrarEtapaFunil()` idempotently appends a sigla to `leads.funnel_stages` (a tag string, not a normalized join table) — `/api/metrics` derives per-stage counts with `LIKE '%[XX]%'` against that string. The **same sigla list is duplicated in the painel repo** (`STATUS_CONFIG`/`SIGLAS` there) — keep both in sync when adding/renaming a stage. `PATCH /api/leads/:id/status` whitelists both the status string and the sigla against fixed arrays (`PERMITIDOS`/`SIGLAS_VALIDAS`) — adding a new manually-settable stage requires updating that whitelist here, not just the frontend.

### External integrations

- **Anthropic (Claude)** — conversation + lead scoring, plain HTTP via `axios` (no SDK).
- **Google Calendar** — service-account JWT (`GOOGLE_SERVICE_ACCOUNT_KEY`), used for slot lookup/booking/rescheduling (`buscarHorariosDisponiveis`, `criarEvento`, `remarcarEvento`), impersonating `comercial@cliqueefecha.com.br` (`CALENDAR_ID`).
- **Groq Whisper** — optional audio transcription; bot runs without it (with a warning) if `GROQ_API_KEY` is absent.
- **Supabase** — used here only as the JWT issuer/verifier for the painel's users, via the service-role key (full DB access, only used for `auth.getUser`).
- **WhatsApp Business API (Meta)** — outbound sends (`enviarMensagem`) and inbound webhook. Invalid/unreachable numbers are auto-detected by Meta error code and the lead is marked inactive rather than retried.

## Domain rules (not visible from code alone)

- **The bot is the product demo.** It presents itself as "Lucas," a human-sounding rep for a WhatsApp-automation company, running a SPIN-Selling-style script: understand the business → surface the pain → bridge to a free 30-min **diagnóstico** (the word "consultoria" was deliberately retired everywhere — keep saying diagnóstico) → book it via Calendar/Meet → manage the whole post-booking journey (reminders, confirmation, reschedule, no-show) → recover cooled-off leads. Every UX decision (pacing, tone, silence rules) is judged against "does this feel like the product we're selling" — e.g. reply delays were deliberately cut from 10s to 1.5–3s for this reason.
- **Conversation style rules** (apply to every generated message, including follow-ups): no em dash (—) ever; light WhatsApp register ("tô", "tá", "pra") without heavy slang; **at most one emoji**, only as a closing reaction, never mid-sentence or next to a phone/email/booking detail; **exactly one question per message**; short messages (1–2 short paragraphs); never invent prices, discounts, deadlines, clients, or case studies (the company has no clients yet, so it leans on the live demo and the human specialist instead of social proof); no repeated validation filler across nearby messages ("Faz sentido", and "Pô" specifically is banned outright). The one-question rule is enforced globally in the prompt ("REGRA DE UMA PERGUNTA POR MENSAGEM") **plus** an explicit opening-message lock — the opening must END at "Posso te chamar de X?" with nothing appended; both guards exist because Claude used to chain two questions in the greeting.
- **Scripted control markers** embedded in the conversation/prompt machinery: `|||` splits one logical turn into multiple WhatsApp messages; `[NOME:]`, `[SLOT:]`, `[VERIFICAR_DATA:]`, `[ENCERRAR]` are internal tags the script uses to signal state transitions. If you're touching the system prompt or message-splitting logic, grep for these markers first.
- **Email capture is a system-level two-step, not a Claude behavior**: when the lead sends an email during the scheduling stage, the code intercepts it *before* Claude (`emailPendente`/`emailConfirmado` on `agendamentos[phone]`), replies "Anotei aqui: ... Tá certinho?" itself, and only books after the lead confirms (`interpretarRespostaEmail` in `heuristicas.js`). The prompt explicitly tells Claude to stay silent in this step — don't "fix" the prompt to make Claude confirm emails, it will double-message.
- **Every lead-facing message must go through `enviarERegistrar`, never bare `enviarMensagem`** (bare sends are only for `MEU_NUMERO`/specialist notifications). System messages that skip the history make Claude blind to what already happened — this caused a real production bug where a lead with a confirmed meeting got re-asked to confirm their email the next day, because the booking-confirmation messages were never in `conversas[phone]`. Consequence of registering them: consecutive assistant turns in history — `chamarClaude` (and the resumo/follow-up calls) merge them via `mesclarTurnosConsecutivos` before hitting the API. The dynamic context block also switches when `agendamentosConfirmados[phone]` exists: it tells Claude the meeting is booked and to stop offering slots/asking for email.
- **Fast-track**: a lead with clear buying intent ("quero contratar") skips qualification and jumps straight to name + scheduling. The bot also avoids re-asking anything already volunteered in the lead's first message, and recognizes returning leads / post-no-show leads instead of restarting the script.
- **Objection handling and de-escalation are scripted policy, not just prompt flavor**: e.g. "vou pensar" always gets a reserved no-commitment slot offered (never left as a dead end); hostile/irritated leads get de-escalation + an offer to hand off to the human specialist, and a request to stop is honored immediately.
- **Rescheduling is capped at 2 attempts** per lead (see `agendamentosConfirmados[...].totalRemarcacoes`). A reschedule request goes straight to offering new slots in a **single message** ("Sem problema, vamos remarcar! ..."), never a two-step "want to reschedule? → ok, here are slots".
- **Cancellation asks for a reason**: after confirming a cancellation the bot waits ~1.2s, asks "o que pesou pra desmarcar" (🙏), and `motivoCancelamentoPendente` intercepts the next inbound message (24h window) *before* Claude — the reason becomes a **completed** bot-origin task on the lead ("Cancelou reunião: ...") and notifies `MEU_NUMERO`. Deliberately NOT recorded as "Perdido": cancelling a meeting ≠ lost deal; the lead goes back to 'Pronto para agendar'.
- **Timezone assumption**: Campo Grande/MS is treated as fixed UTC-4 with no DST (true since 2019); Brasília = Campo Grande + 1h. This is hardcoded logic (`horarioCampoGrande`, `dentroDoHorarioSilencio`), not looked up — it breaks if Brazil's DST rules ever change again.

## Known issues & roadmap

- **Multi-tenant authorization**: `verificarToken` validates the Supabase JWT *and* checks the user is linked to this deployment's `CLIENT_ID` via the `user_clients` table (with 60s in-memory caching of both checks). There is **no bootstrap/auto-link** (removed on purpose, BOT-004): with zero linked users everyone gets 403 and the log prints the manual INSERT — the supported path is `criar-cliente.js`. `user_clients.role` exists (default `'admin'`) as groundwork for future permissions; nothing filters by it yet.
- **Hot state is single-process, in-memory only** (see Architecture above) — the intended fix is moving `conversas`/`agendamentosConfirmados`/etc. to Redis, not yet done. Don't assume this bot can run as more than one instance.
- **Prompt caching is implemented**: `chamarClaude` sends the script (historico[0]) as a `system` block with `cache_control: ephemeral`, plus a second non-cached dynamic block (current greeting + fresh slots) passed by the caller. The stored conversation format is unchanged ([user roteiro, assistant ack, ...turns]); only the API request shape differs — don't "simplify" it back to plain messages.
- **`/api/*` has Helmet + express-rate-limit** (120 req/min per IP, `trust proxy` set for Railway). The WhatsApp webhook keeps its own per-phone rate limiting.
- **PII in logs**: phone numbers are always masked (`mascararTelefone` → `***1234`); message content is logged by default but redacted when `LOG_CONTEUDO=false` (set it in production). LGPD data deletion is covered by the trash flow (`/definitivo` cascades tasks + meeting_analyses + lead) plus the 30-day auto-purge.
- **Unit tests exist for the text heuristics** (`heuristicas.test.js`, run via `npm test`) — but `interpretarPedidoData` (calendar-dependent) is still only validated through real WhatsApp conversation testing.
- **`MEU_NUMERO` (the salesperson's number) is a single hardcoded env var** — fine for one salesperson; once the painel supports multiple salespeople, this needs to come from the CRM instead.
- **The one real production gap is Meta message templates (BOT-001)**: once a lead is silent past Meta's 24h window, any proactive send (follow-up, reactivation) fails with error 131047 and silently never arrives — the bot needs approved templates to reach cold leads. Until then, follow-up only works inside the 24h window.

## Reference

- Standalone scripts (all load the local gitignored `.env` via `try { require('dotenv').config() } catch {}` — they run against **production**, be deliberate):
  - `criar-cliente.js` — client onboarding: creates the `clients` row, finds/invites the panel user in Supabase Auth, links `user_clients`, prints the manual checklist (Railway envs, Meta, Calendar).
  - `seed-leads.js` — populates `leads` with realistic fake leads; every seeded name gets a `" (teste)"` suffix so real leads (the Instagram bio link is public) are distinguishable.
  - `limpar-leads-teste.js` — removes only the `" (teste)"` leads.
  - `limpar-banco.ps1 -Confirmo -Sim` — wipes lead/state tables (preserves `clients`/`user_clients` unless `-Tudo`); restart the bot afterwards so in-memory state doesn't resurrect ghosts.
- Bot version is manually bumped in `BOT_VERSION`/`BOT_VERSION_DATA` at the top of `index.js` and surfaces via `/health` and `/api/health` — this is how a deploy is confirmed to have gone out. **Never bump it with `sed`** (a no-match sed exits 0 and the stale version ships silently — happened for five releases straight): use the Edit tool, then grep the new version string before committing.
- Claude model comes from `CLAUDE_MODEL` (default `claude-sonnet-5`).
- The painel (`painel-clique-fecha`) is a separate repo/chat that consumes this API — when a change here affects what the painel needs to display or call, that gets communicated via `CONTEXT.md`-style docs, not shared code.
