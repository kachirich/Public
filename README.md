# Professional Access Marketplace

Backend for a marketplace selling monetized access to professionals (doctors,
lecturers, consultants) outside their normal availability. Professionals never
install an app — they receive and answer booking requests entirely inside
WhatsApp. Clients use a web UI. Payments are escrow-based.

`claude-code-prompt.md` is the build spec; `schema.sql` is the frozen source
of truth for the data model (applied verbatim by the initial migration).

## Layout

| Path | What it is |
|---|---|
| `apps/orchestrator` | All business logic: HTTP API, webhooks, BullMQ outbox dispatcher + timer poller |
| `apps/wa-gateway` | Thin OpenWA wrapper: outbound sends, group rooms, inbound webhook forwarding. No business logic |
| `apps/web` | Next.js client UI (port 3002): browse professionals, book, pay, track requests, pick counter-offer slots. Talks to the orchestrator server-side only |
| `packages/core` | Ports, the state machine (`transition()` is the only writer to `requests.state`), templates, reply parser, tier classification, in-memory fakes |
| `packages/adapters` | Cal.com, Paystack, Resend, wa-gateway clients — apps import these, core never does |
| `packages/db` | node-pg-migrate migrations (initial = schema.sql verbatim) |
| `packages/config` | Shared zod env loading |

## Quickstart

```bash
corepack enable                     # or: use `corepack pnpm` everywhere
pnpm install
docker compose -f docker-compose.dev.yml up -d

cp .env.example .env                # adjust DATABASE_URL/REDIS_URL ports to 5435/6380
DATABASE_URL=postgres://postgres:postgres@localhost:5435/marketplace_dev pnpm run migrate:up

# terminal 1
DATABASE_URL=postgres://postgres:postgres@localhost:5435/marketplace_dev \
REDIS_URL=redis://localhost:6380 \
INTERNAL_SHARED_SECRET=change-me-to-a-long-random-string \
PORT=3000 pnpm --filter @marketplace/orchestrator run dev

# terminal 2
ORCHESTRATOR_BASE_URL=http://localhost:3000 \
INTERNAL_SHARED_SECRET=change-me-to-a-long-random-string \
OPENWA_API_URL=http://localhost:2785 \
PORT=3001 pnpm --filter @marketplace/wa-gateway run dev

# terminal 3 — web UI on http://localhost:3002
ORCHESTRATOR_URL=http://localhost:3000 pnpm --filter @marketplace/web run dev
```

Without provider env vars (Paystack, Cal.com, Resend, OpenWA) the
orchestrator boots with a log-only messaging adapter and provider ports that
fail loudly on use — the outbox/timer loops still run, so the full machinery
is exercisable locally. See `.env.example` for the provider variables.

## Tests

```bash
docker compose -f docker-compose.dev.yml up -d
DATABASE_URL=postgres://postgres:postgres@localhost:5435/marketplace_dev \
REDIS_URL=redis://localhost:6380 pnpm run test
```

State machine, outbox, and timer tests run against real Postgres; the worker
integration test needs Redis; template/parser/adapter tests are pure. CI
(`.github/workflows/ci.yml`) provisions both services and runs
migrate → build → typecheck → test.

## Architecture invariants (do not break)

- `transition()` in `packages/core/src/state/transition.ts` is the ONLY code
  path that writes `requests.state` — one transaction: row lock, version
  check, legality check against the `VALID_TRANSITIONS` data table, audit
  row, ledger entries, outbox rows, timer rows.
- `ledger_entries` is append-only. No updates, no deletes.
- Timers re-read state when they fire; a stale timer is a SKIP, not an error.
- Webhooks dedupe through `webhook_events`, inbound WhatsApp through
  `wa_message_id`, outbox rows through `idempotency_key` — before any
  business logic runs.
- Core imports ports, never adapters. The wa-gateway holds no business logic.
- Professionals must be `VERIFIED` to be quotable (phase 7 hard gate in
  `createQuote`).
