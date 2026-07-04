# Build: Professional Access Marketplace — Core Orchestrator

You are building the backend for a marketplace that sells **monetized access to
professionals (doctors, lecturers, consultants) outside their normal availability**.
Professionals never install an app — they receive and answer booking requests
entirely inside WhatsApp. Clients use a web UI. Payments are escrow-based.

The architecture is already decided. Do not redesign it — implement it.
`schema.sql` in the repo root is the source of truth for the data model.
Implement it exactly; if you believe a change is needed, stop and ask first.

## Stack

- Node.js 20+, TypeScript (strict), Fastify for HTTP
- Postgres 15 (schema in `schema.sql`; use node-pg-migrate with schema.sql as the initial migration)
- BullMQ + Redis for the outbox dispatcher and durable timer polling
- Vitest for tests
- Two deployable services in one monorepo (pnpm workspaces):
  - `apps/orchestrator` — all business logic, HTTP API, webhooks, timers
  - `apps/wa-gateway` — thin OpenWA wrapper: sends queued messages, receives
    inbound WhatsApp messages, forwards them to the orchestrator. No business logic.

## Architecture rules (non-negotiable)

1. **Ports and adapters.** Core logic depends only on interfaces in `packages/core/ports/`:
   - `SchedulingPort` — implemented by `CalcomAdapter` (self-hosted Cal.com REST API)
   - `MessagingPort` — implemented by `OpenWaAdapter`, `EmailAdapter` (Resend), and a
     stub `TelegramAdapter`
   - `PaymentsPort` — implemented by `PaystackAdapter` (M-Pesa + card via Paystack)
   Core code must never import an adapter directly. Every adapter also gets an
   in-memory fake for tests.

2. **The state machine is a data table.** Define the request lifecycle as a literal
   map of valid transitions (below). A single `transition(requestId, toState, actor,
   reason, metadata)` function is the ONLY way state changes. It must, in ONE
   database transaction:
   - re-read the request with `SELECT ... FOR UPDATE` and check `version`
   - verify the transition is legal, else throw `IllegalTransitionError`
   - update `requests.state` and increment `version`
   - insert a `request_transitions` row
   - insert any `ledger_entries` for that transition
   - insert `outbox_messages` rows for every notification that transition triggers
   - insert/adjust `scheduled_jobs` rows for new timers
   Nothing outside this function writes to `requests.state`. Ever.

3. **Valid transitions:**
   ```
   REQUESTED        -> PENDING_PAYMENT | CANCELLED
   PENDING_PAYMENT  -> HELD | CANCELLED
   HELD             -> ACCEPTED | DECLINED | EXPIRED | COUNTER_OFFERED
   COUNTER_OFFERED  -> ACCEPTED | DECLINED | EXPIRED
   ACCEPTED         -> IN_SESSION | NO_SHOW_PROFESSIONAL | NO_SHOW_CLIENT
   IN_SESSION       -> COMPLETED | NO_SHOW_PROFESSIONAL | NO_SHOW_CLIENT
   DECLINED         -> REFUNDED
   EXPIRED          -> REFUNDED
   NO_SHOW_PROFESSIONAL -> REFUNDED
   ```
   Terminal: REFUNDED, COMPLETED, NO_SHOW_CLIENT (professional paid in full),
   CANCELLED. Illegal transitions are logged and answered with the current state —
   never executed, never silently ignored at the ledger level.

4. **Money rules.** Acceptance COMMITs funds (client can no longer freely cancel);
   RELEASE to the professional happens only on COMPLETED or NO_SHOW_CLIENT.
   DECLINED / EXPIRED / NO_SHOW_PROFESSIONAL trigger a full REFUND. If an accepted
   counter-offer slot falls in a cheaper tier, issue a PARTIAL_REFUND of the
   difference at acceptance (always charge the lower of the two tier prices).
   The `ledger_entries` table is append-only — no updates, no deletes.

5. **Timers check state, never assume it.** A poller claims due `scheduled_jobs`
   rows and calls handlers. Every handler re-reads the request; if the state has
   moved on, mark the job SKIPPED and exit. Timer set: CARD_REMINDER (halfway to
   expiry), CARD_EXPIRY, COUNTER_EXPIRY (12h), ROOM_OPEN (T-15min),
   NO_SHOW_CHECK (start+5min nudge, start+15min no-show), SESSION_END_WARNING
   (end-10min), SESSION_END, ROOM_DISSOLVE (end+30min).

6. **Idempotency everywhere.** Webhooks (Paystack, Cal.com, OpenWA) insert into
   `webhook_events` first; a unique-violation means duplicate — ack and exit.
   Outbox rows carry a unique `idempotency_key` = `requestId:templateKey:transitionId`.
   Inbound WhatsApp messages dedupe on `wa_message_id`.

## Tier classification

On quote creation, query Cal.com availability for the professional and classify
the requested time: inside availability = IN_HOURS; outside hours on a working
day = OFF_DUTY; on a blocked/non-working day = OFF_DAY; start within 60 minutes
= PREMIUM_INTERRUPT (overrides the others). Card expiry scales with tier:
PREMIUM_INTERRUPT 15min, OFF_DUTY 4h, OFF_DAY 12h, IN_HOURS 12h. Pricing per
tier comes from a per-professional config with platform defaults. On ACCEPTED,
create the Cal.com booking (force-book for off-availability tiers) and store
`calcom_booking_id`. Re-validate slot availability at acceptance time — if a
counter-offer slot was taken meanwhile, reject with a clear error.

## WhatsApp interaction (wa-gateway + orchestrator parser)

Cards use NUMBERED REPLIES, not WhatsApp buttons (unreliable on OpenWA):
- `1` accept, `2` decline, `3` decline-wrong-time (triggers counter-offer flow),
  `4` decline-need-info. Parse loosely (`1`, `yes`, `accept`, `ok` all = accept).
- Every card carries a `#REF` code. If a professional has exactly one pending
  card, a bare reply matches it; if several, ask which (`Reply 1 for #R4X2...`).
- Unparseable input gets a gentle re-prompt, never a guess.
- Counter-offer flow: after `3`, prompt for up to 3 alternative times (one per
  line, parsed with chrono-node), check each against Cal.com for conflicts,
  ECHO BACK the parsed slots for confirmation before sending to the client.
  One counter round per request (enforced by the UNIQUE constraint).
- Replies on expired/settled requests get: current status + what happened to
  the money. Never act twice.

## Message templates

Implement as pure functions `(payload) => string` in `packages/core/templates/`,
snapshot-tested. Keys: REQUEST_CARD, CARD_REMINDER, ACCEPTED_PROFESSIONAL,
ACCEPTED_CLIENT, DECLINED_CLIENT, EXPIRED_CLIENT, COUNTER_PROMPT,
COUNTER_CONFIRM_ECHO, COUNTER_SENT_CLIENT, PARTIAL_REFUND_CLIENT, ROOM_WELCOME,
NO_SHOW_NUDGE, NO_SHOW_CLIENT_REFUND, SESSION_END_WARNING, PAYOUT_CONFIRMED,
REBOOK_PROMPT. Rules: professional-facing money = NET payout; client-facing
money = gross; client contact details NEVER appear in any professional-facing
template before a consult room exists; every professional-facing template
includes the `#REF` code.

## HTTP API (orchestrator)

- `POST /quotes` — client picks professional + time; returns tier + price breakdown
- `POST /quotes/:id/pay` — initiate payment (Paystack init), -> PENDING_PAYMENT
- `POST /webhooks/paystack` — payment confirmed -> HELD (sends REQUEST_CARD)
- `POST /webhooks/calcom` — booking events
- `POST /internal/wa-inbound` — wa-gateway forwards inbound messages (shared-secret auth)
- `GET /requests/:id` — state + transition history (client UI polls this)
- `POST /counter-offers/:id/choose` — client picks a slot -> ACCEPTED
- Health checks on both services.

## Build order — commit after each phase, with tests green

1. Monorepo scaffold, migrations from schema.sql, config loading, CI script.
2. State machine core: transition function, transition table, optimistic locking,
   ledger writes. Unit-test every legal transition and a representative set of
   illegal ones, including the concurrent accept-vs-expiry race (two parallel
   transactions; exactly one wins).
3. Outbox dispatcher (BullMQ) + timer poller, with fake MessagingPort. Test:
   timer firing after state moved on = SKIPPED, no message sent.
4. Templates + WhatsApp reply parser (pure functions, heavy test coverage:
   ambiguous refs, loose accepts, garbage input, counter-offer date parsing).
5. Adapters: CalcomAdapter (availability query + classify + create/cancel
   booking), PaystackAdapter (init, webhook verify, refund), EmailAdapter,
   OpenWaAdapter in wa-gateway (send text, create group, add/remove
   participants, dissolve group, inbound listener).
6. End-to-end happy path against fakes: quote -> pay -> card -> accept -> room
   opens -> session completes -> payout ledger entry -> room dissolved. Then the
   three refund paths, then the counter-offer path incl. partial refund.

## Do not

- Do not put business logic in adapters or in the wa-gateway.
- Do not call OpenWA, Paystack, or Cal.com directly from core code.
- Do not write `requests.state` outside the transition function.
- Do not use WhatsApp interactive buttons.
- Do not update or delete ledger rows.
- Do not invent new states or transitions without asking.

## Phase 7 — Professional verification (addendum)

Extends everything above unchanged; do not refactor completed phases to
accommodate this — add it on top. Slot after the e2e paths (phase 6). Does
not block earlier phases: seed data may mark test professionals `VERIFIED`
directly.

**Migration** (a new node-pg-migrate migration, not an edit to the initial
one): adds `verification_status` enum (`PENDING_VERIFICATION`, `VERIFIED`,
`NEEDS_MANUAL_REVIEW`, `REJECTED`) and column on `professionals`, plus a
`professional_verifications` table (registry, registration_number,
submitted/registry name, fuzzy `name_match_score`, `whatsapp_otp_passed`,
`evidence` jsonb, status, `reviewed_by`) with indexes on
`(professional_id, created_at DESC)` and a partial index on the
`NEEDS_MANUAL_REVIEW` review queue.

**Behavior rules:**

1. Hard gate at quote time: `POST /quotes` must reject any professional
   whose `verification_status != 'VERIFIED'`; non-verified professionals are
   excluded from all client-facing listing/search responses. Enforce in core
   logic, not just the UI — this is the only enforcement point that matters.
2. New port `RegistryPort` with `lookup(registry, registrationNumber) ->
   { found, registryName, raw }`. One adapter per registry (KMPDC, LSK,
   ICPAK, EBK, university registries, etc.) plus an in-memory fake for
   tests. Registry adapters live behind the port like every other
   integration — core code never scrapes directly.
3. Automated pipeline on submission: registry lookup -> fuzzy name match
   (submitted vs registry name; normalize case, order, initials) ->
   WhatsApp OTP confirmation of the professional's number. Score >= 0.85
   with all checks passed -> `VERIFIED`. Registry says not found ->
   `REJECTED` with a message inviting correction/resubmission (up to 3
   attempts). Anything else — scraper error, timeout, ambiguous match,
   registry site changed — -> `NEEDS_MANUAL_REVIEW`. A failing scraper must
   never silently strand a professional in `PENDING_VERIFICATION`.
4. Manual review queue: `GET /internal/verifications/pending` and
   `POST /internal/verifications/:id/decide` (approve/reject + reviewer
   id), shared-secret auth like `/internal/wa-inbound`. Decisions write
   `reviewed_by` and update both tables atomically.
5. Notifications via the existing outbox, new template keys:
   `VERIFICATION_APPROVED`, `VERIFICATION_REJECTED`,
   `VERIFICATION_IN_REVIEW`.
6. Tests: gate rejection on unverified quote attempt; each pipeline outcome
   (verified / rejected / manual review on scraper failure); OTP required
   even when registry match is perfect; resubmission after rejection.

Start with phase 1. Show me the workspace layout and migration setup before
moving to phase 2.
