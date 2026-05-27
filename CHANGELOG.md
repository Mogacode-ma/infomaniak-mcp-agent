# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

_(no unreleased changes yet)_

## [0.10.2] — 2026-05-27

### Fixed (CI)

- `tsc --noEmit` (typecheck): `InfomaniakAuthError.errorType` now uses
  the `override` modifier (TS4114).
- `tsc --noEmit` (typecheck): `defaultAccountId()` no longer trips on
  `noUncheckedIndexedAccess` — uses `ids[0] ?? null`.
- Gitleaks: snapshot fixtures under `tests/snapshots/responses/` are
  allowlisted. They contain ephemeral `confirmation_token` UUIDs from
  real smoke runs — single-use, 60-second TTL, expired before commit;
  not real secrets but the generic-api-key entropy rule flagged them.

## [0.10.1] — 2026-05-27

### Changed

- **`audit_account` now caps live domain re-checks** with the new
  `max_domain_checks` arg (default 50). On accounts with 200+ domains this
  prevents the audit from saturating the 60 req/min rate limit. Skipped
  domains emit an `info` finding rather than disappearing silently.
- **`audit_account` no longer swallows unverifiable expiries.** When the live
  `/1/domain/{name}` endpoint can't return a value (404, network, no DNS
  managed by Infomaniak), the tool now emits an `info` finding so the
  operator knows the audit was incomplete for that domain.
- **`manage_dnssec` annotations relaxed.** `destructiveHint` lowered to false
  because the default action is read-only (`check`); the actual destructive
  paths (`enable`/`disable`) are still gated by the two-phase commit
  confirmation_token, which is the real safety mechanism.

### Added (param descriptions on remaining hot destructive tools)

- `create_database`: regex on `database_name`, hosting prefix behaviour, etc.
- `create_hosting_user`: login format vs hosting prefix, password policy,
  `ssh` vs `ftp` connection types, `home_directory` semantics.
- `create_redirection`: source `name` is the local part only, `targets` must
  be full valid emails.
- `request_certificate`: which fields are required per certificate `type`
  (`free` / `paid` / `custom`), PEM-block hints.
- `provision_site_full`: FQDN format constraint, zone-derivation rule for
  multi-level subdomains, `target_ipv4` default explanation, `skip_dns`
  semantics.

### Notes

This patch is driven by an expert-panel review of v0.10. Five concrete
residual items, all shipped here. `npm test`: 78/78. Lint clean.

## [0.10.0] — 2026-05-27

### Fixed

- **`audit_account` reported false-positive expirations on domain products.**
  `/1/products.expired_at` is the original contract expiry and stays in the past
  even after auto-renewal. The tool now re-fetches the live expiry via
  `/1/domain/{name}` for every domain finding before flagging. On the Mogacode
  account, 5 critical false positives were eliminated (axesspharma.be,
  beachnumber1.be, mertens.brussels, golf-anderlecht.com, upfss.com).

### Changed (consolidation, no loss of capability)

- **`dnssec_check` + `dnssec_enable` + `dnssec_disable` → `manage_dnssec`**.
  Single tool with `action: check | enable | disable`. Two-phase commit is
  preserved on the destructive actions.
- **`get_mailbox_aliases` + `get_mailbox_signatures` + `get_mailbox_backups`
  → `get_mailbox_info`**. Single read tool with a `fields` array. Fetches only
  the requested sections, in parallel. Returns per-section errors for partial
  failures.
- **Tool count: 55 → 51** as a result of these two consolidations (no feature
  removed). TDQS "Tool Count" dimension should improve.

### Added

- **Snapshot regression tests** under `tests/snapshots/`. The 41 live API
  responses captured during the example.com smoke (v0.9) are now CI fixtures and
  asserted against each tool's declared `outputSchema`. Locks the contract so
  the kind of silent Zod-schema drift that bricked three tools in v0.9 can't
  happen again unnoticed.
- **Param descriptions and constraint docs** on the hot destructive tools
  (`create_short_url`, `create_mailbox`, `dns_create_record`). Each param now
  states the format, allowed values, and gotchas (e.g. mailbox = local part
  only, NOT a full email; password = 8 chars + 4 character classes).

### Notes

`npm test`: 78/78. Lint clean. Snapshot tests added 41 cases. The
consolidation is driven by an expert panel review of the v0.9 smoke audit:
keep capability, reduce the agent's tool-selection cognitive load.

## [0.9.0] — 2026-05-27

### Fixed (parser bugs caught by end-to-end smoke test on example.com)

- **`infomaniak_list_mailboxes`** — schema accepted only `type: string`, but the API returns `type: 1` (number) or `null`. All mail tools depending on mailbox enumeration were broken. Schema now accepts string | number | null.
- **`infomaniak_list_databases`** — `application` field was declared as string but the API returns an object `{id, type, name, location}`. `permissions` was `unknown` and is now a typed array of `{user, rights:{read,write,admin}}`. `backups` is now a typed array of timestamps.
- **`infomaniak_get_certificate`** — `last_attempt_at` schema was non-nullable, but is `null` when no issuance attempt has happened yet. Field is now nullable.

### Added

- **`infomaniak_find_site(domain)`** — domain-first site lookup. Resolves a public domain to `{account_id, hosting_id, hosting_label, site_id, full site object}`. Without it, agents had to iterate every hosting via `list_sites` (46+ API calls on a real fleet) to locate a site by name. Useful before any tool requiring `hosting_id + site_id` (get_certificate, list_databases, etc.) when you only know the domain.

### Changed

- **`account_id` is now optional** on `list_hostings`, `list_domains`, `list_mail_hostings`, `list_drives`, `list_swiss_backups`, `audit_account`, `audit_dns_zones`. When omitted, the first account the token can reach is used. The defaulted value is echoed back in the response so the agent knows which account was queried. Discovered via cached `GET /1/account`.
- **`audit_dns_zones`** — added `filter_contains` param to scope the scan to one or a handful of domains, and reduced default `max_domains` from 50 to 20. Filtering by `"example.com"` on a 50-zone account drops execution from ~129s to ~1.4s.
- **Auth error contract** — `InfomaniakAuthError.toToolError()` now returns a `structuredContent` payload `{error: true, error_type: "auth_failure", code, status, actionable}` so agents can branch programmatically instead of parsing the human-readable text.

### Notes

This release is driven by an end-to-end smoke audit run against the real Mogacode Infomaniak account (17 sub-accounts, 309 products, example.com hosted on hosting #999999). Audit findings, raw API response captures and per-tool matrix are documented in the project notes. The three Zod schema bugs above were silently bricking real workflows; the smoke test surfaced them in one run.

## [0.8.2] — 2026-05-20

### Fixed — MCP spec compliance (contributed by [@ruffzy](https://github.com/ruffzy))

PR [#13](https://github.com/Mogacode-ma/infomaniak-mcp-agent/pull/13) fixes two JSON Schema compliance issues that prevented the server from working with strict MCP clients (Claude Code) and with the Anthropic Tool Use API. Both are now addressed by routing every Zod-to-JSON-Schema conversion through a single `toMcpJsonSchema()` helper in `src/server.ts`.

- **`outputSchema` missing `type: "object"` at the root (22 tools affected).** Tools using the two-phase-commit pattern (`infomaniak_undo`, `*_create*`, every destructive tool) declare their output as `z.union([PlanSchema, AppliedSchema])`. `zod-to-json-schema` emits a bare `anyOf` for unions, which is valid JSON Schema but breaks MCP clients that require a top-level `type: "object"` on `outputSchema`. The helper now injects the missing `type` when the schema is a union of objects.
- **`$schema` property rejected by the Anthropic validator.** `zodToJsonSchema` defaults to emitting `"$schema": "http://json-schema.org/draft-07/schema#"`, which Anthropic's Tool Use validator rejects on `outputSchema`. The helper strips it.
- **Target switched to `jsonSchema7`** (was `openApi3`) so `exclusiveMinimum` is emitted as a number per Draft 2020-12 instead of the legacy boolean-with-companion-`minimum` form.

Huge thanks to [@ruffzy](https://github.com/ruffzy) for the first external PR on this repo — clean, focused, well-explained, and exactly the kind of fix only a real user trips over.

## [0.8.1] — 2026-05-12

### Improved
- `infomaniak_get_certificate` now exposes the full response schema, not just the provisioning state. The endpoint `GET /1/web_hostings/{hid}/certificates/{site_id}` actually returns a much richer object than v0.8.0 surfaced — `type`, `sub_type`, `issuer`, `organization`, `main_fqdn`, `emitted_at`, `expired_at`, `fingerprint_sha256`, `is_valid`, `is_expired`, `is_selfsigned`. Verified live against `crm.example.com`'s freshly-issued Let's Encrypt R12 cert. No new endpoint, just a wider Zod schema and an updated tool description so agents and humans see everything that's available.

### Added — SSL certificates (3 new tools)

The MCP can now manage SSL certificates on web hosting sites end-to-end, through the standard two-phase commit. Three new typed tools:

- `infomaniak_get_certificate(hosting_id, site_id)` — read-only. Returns the ACME-flow status (`updating` / `ok` / `error` / …), main FQDN in IDN form, any identifier-level errors, and the timestamp of the last issuance attempt.
- `infomaniak_request_certificate(hosting_id, site_id, type, …)` — destructive, two-phase. Three `type` values are accepted:
  - `free` — Let's Encrypt (no extra fields, Infomaniak runs the ACME flow automatically).
  - `paid` — a pre-purchased Sectigo certificate, requires `certificate_id`.
  - `custom` — bring-your-own PEM certificate, requires `certificate` + `private_key` (and optionally `intermediate_certificate` for the chain).
  Returns an `operation_uuid`; poll `infomaniak_get_certificate` to track progress.
- `infomaniak_delete_certificate(hosting_id, site_id)` — destructive, two-phase. Removes the certificate from the site. Pulls the current status into the plan so the caller sees what is about to be removed. The history entry registers an `infomaniak_request_certificate` with `type: "free"` as the undo action.

Endpoints (verified live, public Bearer auth):
```
GET    /1/web_hostings/{hid}/certificates/{site_id}
POST   /1/web_hostings/{hid}/certificates   body: {site_id, type, ...}
DELETE /1/web_hostings/{hid}/certificates/{site_id}
```

The site object (returned by `infomaniak_list_sites`) already exposes `ssl_status` / `ssl_issuer` / `ssl_emitted_at` / `ssl_expired_at` for quick visibility without hitting these endpoints.

### Documented (REVERSE-ENGINEERING.md)

New section *"SSL certificates"* with the full endpoint map, the `type` enum values discovered via 422, and the rationale for the per-type required-fields validation we run client-side before issuing the call.

Total tool count is now **59** (was 56).

## [0.7.4] — 2026-05-11

### Fixed
- Sanitize examples in `REVERSE-ENGINEERING.md` (`999999` hosting id → `999999`, `myprefix_WP1234567` DB user → `myprefix_WP1234567`) and in `README.md` (`example.com` → `example.com`). These were real identifiers from the maintainer's account that slipped through previous releases. The repo now contains no real account-specific identifiers; all examples use placeholder values.

## [0.7.3] — 2026-05-11

### Added
- `CHROME_PROFILE` and `CHROME_COOKIES_PATH` environment variables to point the auto cookie extractor at a non-default Chrome profile. Real-world setups commonly use named profiles (`Profile 3`, `Profile 4`, etc.) rather than the historical `Default`, and signing out of Chrome can briefly lock the live `Cookies` SQLite file — both cases are now handled cleanly. `CHROME_COOKIES_PATH` takes precedence when both are set; pass it the directory that contains the `Cookies` file.

### Documented (REVERSE-ENGINEERING.md)
- New section *"Manager UI internal API base — `/v3/api/proxypass_2/1/`"*. Reading the production Angular bundle gives an explicit map of the manager's API namespaces: `apiUrl = /v3/api/`, `apiProxy1 = /v3/api/proxypass_2/1/`, `apiProxy2 = /v3/api/proxypass_2/2/`, `apiUrlV1 = /v3/api/1/`. The old `/proxy/1/...` path we had been using and the new `/v3/api/proxypass_2/1/...` path route to the same backend (byte-identical responses verified live). The `/proxy/private/...` namespace is documented as the route family behind some of the most sensitive manager buttons.
- The database-users section now leads with the *recommended SQL rotation path* (used live to rotate 58 WordPress sites on 2026-05-11) rather than the API-side caveat. The `PATCH` side-effect on `applications` and `permissions` is still mentioned, but as the reason a typed `reset_database_password` tool is intentionally not shipped — not as a blocker for users of the MCP.

### Added
- `infomaniak_list_database_users` (read-only) and `infomaniak_get_database_user` (read-only). Two new typed tools wrapping the `GET /1/web_hostings/{id}/database_users` endpoints discovered live. The list returns MariaDB-level user accounts attached to a hosting with their `applications`, `permissions` (per-database `read/write/admin` rights), `protected` flag (true for WordPress-managed users) and direct phpMyAdmin link. The MCP now exposes **56 tools** across 11 areas.

### Documented (REVERSE-ENGINEERING.md)
- New section *"Database users — `PATCH .../database_users/{user}` silently wipes permissions"*. The endpoint `PATCH /1/web_hostings/{hosting_id}/database_users/{user_name}` accepts a `password` field that **does** change the MariaDB password (verified live), but **silently empties the user's `applications` and `permissions` arrays** regardless of what is sent in the body. The API replies `success` but the actual MariaDB grants drop to `GRANT USAGE ON *.*` only, breaking every site that depends on the user. Restoration through the public API is not currently possible (POST `database_users`, PATCH `databases/{db}`, and PATCH `database_users/{user}` all accept a `permissions` payload but ignore it). The only repair we have found is the manager UI's *"Modifier les droits"* form, which presumably hits a manager-private `/proxy/...` endpoint not yet identified.

### Decided NOT to ship
- A typed `infomaniak_reset_database_password` tool. Until the `/proxy/...` permission-restore endpoint is reverse-engineered, exposing this would let agents accidentally break live WordPress sites with no API path back. The recommended rotation procedure is documented inline in `src/tools/databases.ts` and in REVERSE-ENGINEERING.md: SSH in (optionally via `infomaniak_create_hosting_user` with `connection_type: ssh`), run `ALTER USER ... IDENTIFIED BY '...'` directly against MariaDB (the WP user has `admin` rights on its own database, so this works without DB root), then update `wp-config.php`. This path avoids the buggy PATCH entirely.

## [0.7.1] — 2026-05-08

### Fixed
- `infomaniak_create_hosting_user`: `connection_type` enum was wrong. The previous values (`apache_php / ftp / sftp / nodejs`) were a mis-read of the manager UI labels — those describe the *site* environment, not the *hosting user* connection type. Discovered via 422 (`validation_rule_in`) against a live h3 hosting: the API only accepts **`ftp`** (SFTP-only access) or **`ssh`** (full shell + FTP). The schema, default, description, REVERSE-ENGINEERING note and README table are now aligned with the real API. No runtime behaviour change for users who were already passing `ftp` (the default); calls that previously passed `apache_php / sftp / nodejs` were silently failing with 422 anyway.

### Security
- New transitive vulnerability `fast-uri <=3.1.0` (GHSA-q3j6-qgpj-74h6, path traversal via percent-encoded dot segments) pulled in via `@modelcontextprotocol/sdk → ajv@8.20.0`. Resolved with an `overrides` entry forcing `fast-uri ^3.1.2`. Project is back to **0 npm audit vulnerabilities**.

## [0.7.0] — 2026-04-30

### Added (v0.5 work-in-progress)
- Mail redirections CRUD: `infomaniak_list_redirections`, `infomaniak_create_redirection`, `infomaniak_delete_redirection`. Required fields (`name`, `targets`) confirmed via 422.
- Database write: `infomaniak_create_database` and `infomaniak_delete_database`. Both go through the manager-private `/proxy/...` API because the public POST silently no-ops (same pattern as site creation; documented in REVERSE-ENGINEERING.md). Delete plan pulls the live database details (disk usage, linked application).
- FTP / SSH user CRUD: `infomaniak_list_hosting_users`, `infomaniak_create_hosting_user`, `infomaniak_delete_hosting_user`. Required fields (`connection_type`, `login`, `password`) discovered via 422. (The `connection_type` enum shipped in v0.7.0 was incorrect — see v0.7.1 fix below.)
- Escape hatch: `infomaniak_api_call(method, path, query?, body?, confirmation_token?)`. Reaches any documented or undocumented Infomaniak endpoint on `api.infomaniak.com`. Two-phase commit on every non-GET method. Manager-private `/proxy/...` endpoints are intentionally NOT reachable through this tool — use a typed tool.

### Added (v0.4)
- Mail write tools: `infomaniak_create_mailbox` (with strict password policy enforcement), `infomaniak_delete_mailbox` (irreversible, full warning in plan), `infomaniak_create_mailbox_alias`. All two-phase commit. Required fields verified against Infomaniak's 422 validation responses.
- kDrive read-only tools: `infomaniak_list_drives` (with quota / users / maintenance flags), `infomaniak_list_drive_files` (paginated, supports drilling into subfolders).
- AI Tools: `infomaniak_list_ai_products` (account's own AI products), `infomaniak_list_ai_models` (catalogue of public Infomaniak-hosted models — Whisper, Mixtral, Llama variants, embeddings…).

### Added (v0.3)

- `infomaniak_delete_site` — two-phase commit, manager-private endpoint. Pulls the full site detail in the plan so the user can verify what disappears.
- `infomaniak_dns_update_record` — completes the DNS CRUD: shows current vs proposed values, then PUTs the patch.
- `infomaniak_list_databases` and `infomaniak_get_database` (read-only against the documented `/1/web_hostings/{id}/databases` endpoint).
- Session memory: `infomaniak_history` lists destructive actions taken in the current session, each entry tagged as reversible or not. `infomaniak_undo` walks the two-phase commit and dispatches the registered reverse action when available.
- Internal `utils/history` module backing the above tools — caps in-memory entries at 200, never persisted to disk.

### Added (v0.2)
- DNS tools: `infomaniak_dns_list_records`, `infomaniak_dns_create_record` (two-phase commit), `infomaniak_dns_delete_record` (two-phase commit). Endpoints documented at developer.infomaniak.com (`/2/zones/{zone}/records`); list operation verified live.


- Mail tools: `infomaniak_list_mail_hostings`, `infomaniak_list_mailboxes`, `infomaniak_get_mailbox_aliases`. All verified live.
- Domain tools: `infomaniak_list_domains`, `infomaniak_get_domain`. Both verified live.
- Audit tool: `infomaniak_audit_account` flags critical/warning/info findings (expirations, locked products, maintenance, in-progress operations).
- Introspection tools: `infomaniak_help` (intent-based fuzzy lookup) and `infomaniak_explain` (full schema dump for one tool).
- Schemas: `Domain`, `DnsRecord`, `DnsRecordType`, `MailHosting`, `Mailbox`. Adjusted to match actual Infomaniak responses (verified live; corrected `enabled_alias` 0/1→boolean coercion, removed unused `priority`/`*_idn` fields).

### Fixed
- `enabled_alias` from `/1/mail_hostings/{id}/mailboxes/{name}/aliases` is `0|1` int, not boolean — now coerced.
- `DnsRecordSchema`: removed phantom fields (`source_idn`, `target_idn`, `priority`) that Infomaniak never returns; documented that MX/SRV priority is embedded in `target`.
- `tests/setup.ts`: vitest now boots with a placeholder env so config-dependent modules can be imported by tests without crashing.

## [v0.1.0] — 2026-04-30

### Added
- Initial scaffold of the agentic Infomaniak MCP server.
- Public API client with Bearer token authentication against `api.infomaniak.com`.
- Manager-private API client with auto-extraction of `SASESSION` and `MANAGER-XSRF-TOKEN` cookies from local Chrome.
- Token-bucket throttle (60 req/min) shared between both API clients.
- Two-phase commit pattern with single-use confirmation tokens for destructive tools.
- Tools: `infomaniak_overview`, `infomaniak_list_organizations`, `infomaniak_list_hostings`, `infomaniak_list_sites`, `infomaniak_create_site`.
- Typed error hierarchy with actionable suggestions for every known failure mode.
- Structured logging on stderr with sensitive value redaction.
- Full transparency document (`REVERSE-ENGINEERING.md`) listing every undocumented endpoint used.

[Unreleased]: https://github.com/Mogacode-ma/infomaniak-mcp-agent/commits/main
