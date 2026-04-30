# Architecture

This document explains the design decisions behind `infomaniak-mcp-agent`. It is intentionally detailed: if you are evaluating, forking, or contributing, you should be able to understand every layer without reading the source.

## 1. Two Infomaniak APIs, two auth schemes

Infomaniak's online surface is divided in two HTTP APIs that look similar but enforce different auth:

```
                            ┌──────────────────────────────┐
                            │  Infomaniak                  │
                            │                              │
          Bearer token ───► │  api.infomaniak.com          │  ←── documented (1544 endpoints
                            │                              │       on developer.infomaniak.com)
                            │  • profile, products         │  ←── + a few hundred undocumented
                            │  • mail, drive, dns          │       sub-routes (?with=…, /3/drive/…)
                            │  • read-mostly               │
                            └──────────────────────────────┘

                            ┌──────────────────────────────┐
                            │                              │
  SASESSION + ───────────►  │  manager.infomaniak.com      │  ←── undocumented, used by the
  X-XSRF-TOKEN              │  /proxy/...                  │       Angular manager web app
                            │                              │
                            │  • web hosting writes        │
                            │  • secured operations        │
                            └──────────────────────────────┘
```

**Why does this matter?**

- The public API silently accepts POSTs that it then refuses to process. Sending `POST /1/web_hostings/{id}/sites` with a Bearer token returns `200 success` and a `progress_id`, but the site is never created. The manager-private API enforces the real validation (and CSRF).
- Infomaniak's OAuth implementation only exposes `openid profile email phone` to third-party apps (verified via `/.well-known/openid-configuration`). The product scopes (`web`, `mail`, `drive`, etc.) used by the manager itself cannot be granted to OAuth clients today. So OAuth is not an option for write operations.
- The manager-private API uses Laravel's standard CSRF: a `MANAGER-XSRF-TOKEN` cookie issued at session start, with the URL-decoded value echoed in `X-XSRF-TOKEN` for any non-GET.

The MCP transparently routes every call to the right API based on the operation. Read-only listings go through the public client; sites/databases/etc. writes go through the manager client.

## 2. Layered design

```
src/
├── server.ts            ── MCP entry, stdio transport, registers tools
├── config.ts            ── Zod-validated runtime config (loaded once, fail-fast)
│
├── auth/
│   └── cookie.ts        ── SASESSION + XSRF extraction (auto from Chrome / manual)
│
├── api/
│   ├── http.ts          ── PublicApiClient + ManagerApiClient (shared throttle)
│   └── errors.ts        ── Typed error hierarchy + HTTP-to-error mapper
│
├── throttle/
│   └── token-bucket.ts  ── 60 req/min (Infomaniak hard cap, single shared bucket)
│
├── types/
│   └── infomaniak.ts    ── Zod schemas for resources (Account, Product, Site…)
│
├── tools/
│   ├── types.ts         ── Tool definition contract
│   ├── overview.ts      ── First-touch onboarding tool
│   ├── organizations.ts
│   ├── hostings.ts
│   ├── sites.ts         ── + create_site (two-phase commit)
│   └── index.ts         ── Registry consumed by server.ts
│
└── utils/
    ├── confirmation.ts  ── Single-use tokens for destructive ops
    └── logger.ts        ── pino → stderr, with secret redaction
```

Each layer has a single responsibility and no upward references. Tools call `api`, which calls `throttle` + `auth`. Nothing in `api/` knows about MCP; the protocol layer is fully isolated in `server.ts`.

## 3. Throttling: shared bucket, 60 req/min

Both `PublicApiClient` and `ManagerApiClient` share a single `TokenBucket(60, 60_000)`. Why:

- Infomaniak counts requests across BOTH APIs against the same per-token quota.
- Tools that combine multiple HTTP calls (e.g. `infomaniak_overview` does `/account` then `/products`) must collectively stay under the cap.
- The bucket is FIFO: callers acquire in order they arrived. No starvation, no fairness issues.

The bucket is a rolling 60-second window. Each `acquire()` purges expired timestamps, then either accepts immediately or waits for the oldest to expire. Worst case wait ≈ 60 s.

## 4. Two-phase commit for destructive operations

Every destructive tool follows the same pattern:

```
            1st call: no confirmation_token
              │
              ├──> validate input
              ├──> mint token: SHA-stable fingerprint of (tool name + sorted params)
              └──> return  { status: "plan", plan: …, confirmation_token: "uuid", expires_at: … }

            2nd call: same params + confirmation_token
              │
              ├──> consumeToken(token, fingerprint)
              │     - returns false if expired, missing, or fingerprint mismatch
              │     - on success: token deleted (single use)
              ├──> execute the operation
              └──> return { status: "applied", … }
```

Properties:

- **Single-use**: a token is deleted on consumption. Replay attacks within the TTL are impossible.
- **Param-bound**: changing any parameter between plan and apply invalidates the token. Prevents "I asked for site A, server creates site B".
- **TTL-bound**: tokens expire after `CONFIRMATION_TTL_SECONDS` (default 60). Long-stale plans force a re-plan, which re-runs pre-flight checks against fresh state.
- **In-memory only**: tokens are never persisted. A server restart clears all pending plans, which is the safe default.

This pattern keeps the agent honest: it cannot accidentally execute a destructive operation it merely planned, even if its conversation context is corrupted or replayed.

## 5. Error handling: actionable by default

Every error thrown inside the package extends `InfomaniakError` and carries:

| Field | Purpose |
|---|---|
| `message` | Human-readable description of what failed. |
| `actionable` | One-sentence "what you can do about it" suggestion. |
| `status` | HTTP status code (or undefined for non-HTTP errors). |
| `code` | Infomaniak-side error code (e.g. `validation_failed`, `token_mismatch`). |
| `details` | Structured context for debugging. |

The `mapHttpError(status, body, ctx)` function in `api/errors.ts` maps every observed Infomaniak failure pattern (401 not_authorized, 403 forbidden+secured, 419 token_mismatch, 422 validation_failed, 429 rate_limit, 404 method_not_found / object_not_found) to a typed subclass.

Tool handlers convert any caught `InfomaniakError` to a user-facing tool response via `toToolError()`, which includes the actionable suggestion and the status code in the displayed text.

## 6. Logging: stderr only, secrets redacted

We use [pino](https://github.com/pinojs/pino) bound to `process.stderr` (file descriptor 2). The MCP stdio framing reserves stdout for JSON-RPC traffic; writing logs there would corrupt the protocol.

Sensitive paths are redacted automatically: `token`, `access_token`, `Authorization`, `Cookie`, `SASESSION`, `X-XSRF-TOKEN`, `password`, etc. See `src/utils/logger.ts` for the full list.

Each request through `executeRequest` is correlated with a UUID, so users can grep their stderr for a specific call.

## 7. Configuration: validated, cached, single source

`src/config.ts` exports `loadConfig()`, which:

1. Parses `process.env` against a Zod schema.
2. Throws a multi-line, human-readable error if anything is missing or malformed.
3. Caches the result so subsequent calls are zero-cost.

Tools, clients, and the throttle all import the same config instance. There is no path through which a bad env var can silently turn into runtime garbage.

## 8. What is NOT in this MCP (and why)

- **Browser automation (Playwright, Puppeteer)** — too heavy a dependency for an npm package, and unnecessary now that we read cookies from the local Chrome store.
- **Persisted credentials beyond `.env`** — no token or cookie is written to disk by this package. If you set `INFOMANIAK_AUTH_MODE=manual`, your `.env` becomes the source of truth and is your responsibility to keep secret.
- **WordPress install automation** — the manager's WP wizard uses an undocumented multi-step XHR flow that is fragile. Better UX: this MCP creates the empty site, you trigger the WP install in the manager (one click).
- **Cross-tenant aggregation/billing** — Infomaniak partners can list invoices via `/1/account/{id}/invoice`, but exposing aggregated billing to an LLM is a footgun, so we keep it out of v0 by default.

## 9. Future structure

When more tools land, expect this directory to appear:

```
src/
├── workflows/      ── high-level multi-step orchestrations (provision_site, audit_account, …)
└── tools/
    ├── dns.ts
    ├── mail.ts
    ├── drive.ts
    └── help.ts     ── infomaniak_help / explain / resolve / undo / history
```

Workflows compose tools the way tools compose API calls. The same throttling + confirmation rules apply transitively.
