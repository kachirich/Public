# authkit-service

Standalone auth microservice: registration, login, JWT sessions, and
a self-service password-reset flow, with a bundled login UI. Runs and
deploys independently of `apps/orchestrator` — it owns its own Postgres
schema and does not share the orchestrator's `clients`/`professionals`
tables.

## Endpoints

| Method | Path                        | Auth      | Notes                                   |
| ------ | --------------------------- | --------- | ---------------------------------------- |
| POST   | `/api/auth/register`        | —         | Creates an account, sets the session cookie |
| POST   | `/api/auth/login`           | —         | Sets the session cookie                  |
| POST   | `/api/auth/logout`          | —         | Clears the cookie and revokes the JWT server-side |
| GET    | `/api/auth/me`               | cookie    | Current user                             |
| POST   | `/api/auth/forgot-password` | —         | Always responds success (no email enumeration) |
| POST   | `/api/auth/reset-password`  | —         | Single-use token from the reset email    |
| GET    | `/health`                   | —         | Liveness probe                           |

The bundled UI (`public/`) is served from the same origin as the API:
`/login.html`, `/register.html`, `/forgot-password.html`,
`/reset-password.html`, `/me.html`.

## Local development

```bash
cp .env.example .env   # fill in every CHANGE_ME
npm install
npm run dev             # http://localhost:4000/login.html
```

The schema (`users`, `password_resets`, `revoked_tokens`) is created
automatically on startup via idempotent `CREATE TABLE IF NOT EXISTS`
statements in `db.js` — no manual migration step.

## Tests

```bash
npm test    # vitest + supertest, requires a live Postgres (PG* env vars)
```

## Security notes

- Passwords are hashed with bcrypt (cost 12); the password policy requires
  8+ characters with at least one number and one special character.
- Login runs `bcrypt.compare` against a precomputed dummy hash when the
  email isn't found, so response timing doesn't leak account existence.
- Sessions are a JWT in an `httpOnly`, `SameSite=Lax` cookie, `Secure` in
  production. **Logout revokes the token server-side** (by its `jti`, in
  the `revoked_tokens` table) — a copied/leaked token stops working
  immediately on logout rather than remaining valid until its natural
  expiry.
- Password-reset tokens are single-use, expire after 30 minutes, are
  stored only as a SHA-256 hash, and `forgot-password` always returns the
  same generic response whether or not the account exists.
- `authLimiter` (20 req/15 min) and `passwordResetLimiter` (5 req/hour) are
  enforced in production and skipped in dev/test. They're in-memory — if
  this service is ever scaled to multiple instances, swap in a shared
  store (e.g. `rate-limit-redis`) so limits apply across instances.
- `helmet()` default CSP is used as-is (no `unsafe-inline` for scripts) —
  the bundled UI only ever loads external `.js`/`.css` files.
- CORS is closed by default: only origins listed in `CORS_ORIGIN` may call
  the API with credentials.
