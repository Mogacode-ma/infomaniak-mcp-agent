# infomaniak-mcp-agent

[![CI](https://github.com/Mogacode-ma/infomaniak-mcp-agent/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Mogacode-ma/infomaniak-mcp-agent/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Mogacode-ma/infomaniak-mcp-agent/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/Mogacode-ma/infomaniak-mcp-agent/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-43853d.svg)](https://nodejs.org)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-1.0-9333ea.svg)](https://modelcontextprotocol.io/)
[![Tools](https://img.shields.io/badge/tools-54-blueviolet.svg)](#tools)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

> **Drive your entire [Infomaniak](https://www.infomaniak.com) account from [Claude](https://www.anthropic.com/claude) — agentic, two-phase commit, open-source.**

`infomaniak-mcp-agent` is an unofficial [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes the full surface of Infomaniak — Switzerland's sovereign cloud — as **54 tools** an LLM can call directly: web hosting, mail (kSuite), kDrive, domains, DNS, DNSSEC, FTP/SSH users, AI products, account audits and more. Every destructive operation goes through a strict two-phase commit, so an agent can never silently delete or mutate something on your account.

```
You → Claude:  "audit the example.com hosting and tell me which mailboxes are over quota"
Claude → MCP:  infomaniak_audit_account → infomaniak_list_mail_hostings → infomaniak_list_mailboxes
Claude → You:  3 mailboxes >85% — paul@ (94%), notify@ (88%), team@ (87%). Want me to add an alert?
```

## Table of contents

- [Why](#why-this-exists) · [What it does](#what-you-can-do-with-it) · [How it differs](#why-agentic-and-not-wrapper)
- [Install](#install) · [Authentication](#authentication) · [Quick example](#quick-example)
- [Tools](#tools) (54 across 11 areas) · [Limitations](#limitations) · [Roadmap](#roadmap) · [FAQ](#faq)
- [Contributing](#contributing) · [License](#license)

## Why this exists

Infomaniak is one of the very few **independent, Swiss-owned, open-source-friendly cloud providers** in Europe — running its own datacentres in Switzerland, on hydro and wind power, with no parent in the US or China. Its product range is huge (web hosting, mail, kDrive, kChat, DNS, AI cloud, Swiss Backup, …) but its API is split between a documented public surface and a private manager-only one — which means automating real workflows usually requires a browser session, custom scripts, or both.

This project closes that gap by exposing **everything** through a single MCP server, so Claude or any other MCP client can run real account operations through natural language: provision a hosting, rotate a DNS record, create a mailbox, audit your domains for upcoming expirations, browse your kDrive — without ever forcing you to leave the chat or write a script.

## 🎒 Built in the open, in real time, by vibe-coding

This project was built rapidly by an LLM driving a terminal session ("vibe-coding"), with live tests against a real Infomaniak account at every step. **It works perfectly on the maintainer's local setup** and the full pipeline is green (TypeScript strict, ESLint, Prettier, 37 tests, build, CodeQL, gitleaks).

That said — given how it was built and given that several endpoints used here are reverse-engineered (see [`REVERSE-ENGINEERING.md`](./REVERSE-ENGINEERING.md)) — **it is entirely possible that you'll hit (potentially big) bugs** depending on your account topology, plan tier, scopes, or Infomaniak's own changes. We are here to fix them as they show up. Please:

1. Open an issue with the exact tool call, the input, the response, and your environment (Node version, OS, MCP client). Sanitize tokens / cookies / customer names before pasting.
2. Or, even better, send a PR with a failing test and we will work from there together.

We move fast and ship often. Don't be shy.

## ⚠️ Status: unofficial

This project is **not affiliated with, endorsed by, or sponsored by Infomaniak Network SA**. It is a community-driven tool that combines:

1. The **public Infomaniak API** ([api.infomaniak.com](https://developer.infomaniak.com/)), used with a Bearer token you generate yourself.
2. **Reverse-engineered manager endpoints** ([manager.infomaniak.com/proxy/...](https://manager.infomaniak.com/)), required for write operations on web hosting that the public API silently ignores.

For full transparency, read [`REVERSE-ENGINEERING.md`](./REVERSE-ENGINEERING.md). Infomaniak may change these endpoints without notice; we do our best to keep up but cannot guarantee long-term compatibility.

## What you can do with it

Once installed, you can ask Claude things like:

- *"List every domain on my account that expires in less than 60 days, sorted by date."*
- *"Create a new site `staging.example.com` on hosting `WP1234567`, PHP 8.3, root in `/sites/staging`."*
- *"Add a TXT record on `example.com` for the new Postmark DKIM, then verify it resolves."*
- *"How much disk does the database `myprefix_wp123456` use, and which application is wired to it?"*
- *"Create a mailbox `hello@example.com` with a 16-character random password and forward it to my Gmail."*
- *"Show me which kDrives I'm an admin on and how full they are."*
- *"Audit my whole account: any locked product, expiring SSL, broken DNSSEC, ongoing operations?"*
- *"Undo the last DNS change I made through this session."*

It will not silently mutate anything destructive: every change goes through a *plan + confirmation token* round-trip. You stay in control even if the model gets creative.

## Why "agentic" and not "wrapper"

Most MCP servers expose one tool per HTTP endpoint and call it a day. This one is built differently:

- **Guided dialogues** — creating a site walks you through "which organization? which hosting? root domain or subdomain? what type? recap?" instead of asking you to know the right tool to call upfront.
- **Two-phase commit** — every destructive operation returns a *plan* with a single-use confirmation token (60 s TTL). Nothing is mutated until you call back with the token.
- **Pre-flight checks** — the server checks for conflicts (existing FQDN, busy hosting, expired domain) *before* hitting the API.
- **Actionable errors** — every error tells you what happened, why, and the next step you can take.
- **Introspection** — `infomaniak_overview`, `infomaniak_help` and `infomaniak_explain` give the agent context-on-demand instead of forcing it to memorize a tool catalog.
- **Session memory** — `infomaniak_history` lists every destructive action of the current session, and `infomaniak_undo` reverses the ones that are reversible.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design rationale.

## Install

> ⚠️ **Not published on npm.** Install from source — see the [FAQ](#why-not-on-npm) for why.

```bash
git clone https://github.com/Mogacode-ma/infomaniak-mcp-agent.git
cd infomaniak-mcp-agent
npm ci
npm run build
```

The build output is in `dist/server.js` and is what your MCP client will run.

### Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%AppData%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "infomaniak": {
      "command": "node",
      "args": ["/absolute/path/to/infomaniak-mcp-agent/dist/server.js"],
      "env": {
        "INFOMANIAK_API_TOKEN": "paste-your-token-here",
        "INFOMANIAK_AUTH_MODE": "auto"
      }
    }
  }
}
```

Restart Claude Desktop to pick up the change.

### Configure Claude Code

```bash
claude mcp add infomaniak \
  -e INFOMANIAK_API_TOKEN=paste-your-token-here \
  -e INFOMANIAK_AUTH_MODE=auto \
  -- node /absolute/path/to/infomaniak-mcp-agent/dist/server.js
```

## Authentication

Two distinct credentials are needed because Infomaniak runs two APIs side-by-side:

| API | Auth | Purpose |
|---|---|---|
| `api.infomaniak.com/{1,2}/...` | **Bearer token** | Read-mostly: profile, products, mail, drive, dns, domains, billing |
| `manager.infomaniak.com/proxy/...` | **SASESSION cookie + CSRF token** | Writes on web hosting (sites, databases, applications) |

### 1. Bearer token (required)

1. Sign in to your Infomaniak account.
2. Go to [manager.infomaniak.com/v3/ng/profile/user/token/list](https://manager.infomaniak.com/v3/ng/profile/user/token/list).
3. Click **"Create a token"**, give it a long lifetime, copy the value.
4. Set it in `INFOMANIAK_API_TOKEN`.

### 2. Manager session (auto, recommended)

The manager-private API does not accept Bearer tokens or OAuth (Infomaniak only exposes `openid profile email phone` scopes to third-party apps; `web`, `mail`, etc. are reserved). Instead, we read the `SASESSION` and `MANAGER-XSRF-TOKEN` cookies that **your local Chrome already has** when you are logged into [manager.infomaniak.com](https://manager.infomaniak.com).

With `INFOMANIAK_AUTH_MODE=auto` (the default), the MCP reads these cookies on demand using [`chrome-cookies-secure`](https://www.npmjs.com/package/chrome-cookies-secure). Nothing is ever written to disk; cookies live in memory for the duration of one operation.

When the session expires, simply reload [manager.infomaniak.com](https://manager.infomaniak.com) in Chrome — the MCP will pick up the fresh cookies on the next call.

### 3. Manager session (manual fallback)

For headless environments or troubleshooting:

```env
INFOMANIAK_AUTH_MODE=manual
INFOMANIAK_SASESSION=...
INFOMANIAK_XSRF_TOKEN=...
```

To copy them: open Chrome DevTools on [manager.infomaniak.com](https://manager.infomaniak.com), Application → Cookies, copy `SASESSION` and `MANAGER-XSRF-TOKEN` (URL-encoded — paste as-is, the MCP decodes).

## Quick example

A typical first conversation, end-to-end:

```text
You:    What's on my account?
Claude: [calls infomaniak_overview]
        You have 16 organizations, 311 products: 47 web hostings, 73 domains,
        12 mail hostings, 3 kDrives, 2 AI Tools subscriptions.

You:    Any domain expiring soon?
Claude: [calls infomaniak_audit_account on each org]
        2 domains expire in <30 days: example.com (April 22), demo.org (May 04).
        4 SSL certificates were auto-renewed in the last 7 days. No locked products.

You:    Create a TXT record on example.com saying "v=spf1 include:spf.example.net ~all".
Claude: [calls infomaniak_dns_create_record → returns plan + token]
        Plan: CREATE TXT record on example.com → "v=spf1 include:spf.example.net ~all", TTL 3600.
        Confirm with token abc-123 within 60 s.

You:    Confirm.
Claude: [calls infomaniak_dns_create_record again with the token]
        Done. Record id 84219113. Logged in session history (undoable).
```

## Tools

54 tools across 11 areas. Use `infomaniak_help` to fuzzy-search by intent, or `infomaniak_explain` to dump a tool's full JSON schema.

### Introspection (start here)
| Tool | Annotation | Purpose |
|---|---|---|
| `infomaniak_overview` | read-only | Summary of organizations + products. Best first call. |
| `infomaniak_help` | read-only | Suggest tools matching a free-form intent ("create site", "list mailboxes"…). |
| `infomaniak_explain` | read-only | Returns the full definition (description + schemas) of a specific tool. |
| `infomaniak_audit_account` | read-only | Scan an organization for expirations / locked products / ongoing ops. |
| `infomaniak_history` | read-only | List destructive actions taken in this session. |
| `infomaniak_undo` | **destructive** | Reverse a session action when reversible (two-phase commit). |

### Organizations & products
| Tool | Annotation | Purpose |
|---|---|---|
| `infomaniak_list_organizations` | read-only | Accounts you have technical access to. |
| `infomaniak_list_hostings` | read-only | Web hostings (classic + Node.js) for one organization. |
| `infomaniak_list_domains` | read-only | Domains for one organization, with creation + expiration dates. |
| `infomaniak_get_domain` | read-only | Detail of one domain (DNS managed?, DNSSEC, errors). |

### Web hosting sites
| Tool | Annotation | Purpose |
|---|---|---|
| `infomaniak_list_sites` | read-only | Sites on a given web hosting (with applications). |
| `infomaniak_create_site` | **destructive** | Two-phase: returns a plan + token, second call with token actually creates. |
| `infomaniak_delete_site` | **destructive** | Two-phase delete (full preview of the site to be removed). |

### Databases
| Tool | Annotation | Purpose |
|---|---|---|
| `infomaniak_list_databases` | read-only | MariaDB databases attached to a hosting (with disk usage). |
| `infomaniak_get_database` | read-only | Detail of one database. |
| `infomaniak_create_database` | **destructive** | Two-phase create. |
| `infomaniak_delete_database` | **destructive** | Two-phase delete (plan shows disk usage + linked app). |

### FTP / SSH users
| Tool | Annotation | Purpose |
|---|---|---|
| `infomaniak_list_hosting_users` | read-only | FTP / SSH users on a web hosting. |
| `infomaniak_create_hosting_user` | **destructive** | Two-phase create with `connection_type`: `ftp` (SFTP-only) or `ssh` (full shell + FTP). |
| `infomaniak_delete_hosting_user` | **destructive** | Two-phase revoke (files preserved). |

### DNS & DNSSEC
| Tool | Annotation | Purpose |
|---|---|---|
| `infomaniak_dns_list_records` | read-only | Every DNS record on an Infomaniak-managed zone. |
| `infomaniak_dns_create_record` | **destructive** | Two-phase create record (A, AAAA, CNAME, MX, TXT, SRV, NS, CAA, PTR, SPF). |
| `infomaniak_dns_update_record` | **destructive** | Two-phase update (current vs proposed diff in the plan). |
| `infomaniak_dns_delete_record` | **destructive** | Two-phase delete record (with full preview before commit). |
| `infomaniak_dnssec_check` | read-only | DNSSEC status of a zone. |
| `infomaniak_dnssec_enable` | **destructive** | Two-phase enable (signing keys auto-provisioned). |
| `infomaniak_dnssec_disable` | **destructive** | Two-phase disable. |

### Mail
| Tool | Annotation | Purpose |
|---|---|---|
| `infomaniak_list_mail_hostings` | read-only | Mail hostings for one organization. |
| `infomaniak_list_mailboxes` | read-only | Mailboxes on a given mail hosting. |
| `infomaniak_get_mailbox_aliases` | read-only | Aliases configured on a specific mailbox. |
| `infomaniak_create_mailbox` | **destructive** | Two-phase create with password policy enforcement. |
| `infomaniak_delete_mailbox` | **destructive** | Two-phase delete (also wipes stored mail). |
| `infomaniak_create_mailbox_alias` | **destructive** | Two-phase add alias to a mailbox. |
| `infomaniak_get_mailbox_signature` | read-only | Current signature of a mailbox. |
| `infomaniak_update_mailbox_signature` | **destructive** | Two-phase signature update. |
| `infomaniak_get_mailbox_backups` | read-only | List backup snapshots for a mailbox. |
| `infomaniak_list_redirections` | read-only | Server-side mail redirection rules. |
| `infomaniak_create_redirection` | **destructive** | Two-phase create rule (forward `name@…` to N targets). |
| `infomaniak_delete_redirection` | **destructive** | Two-phase delete rule. |

### kDrive
| Tool | Annotation | Purpose |
|---|---|---|
| `infomaniak_list_drives` | read-only | All kDrives the account has access to (with quota). |
| `infomaniak_list_drive_files` | read-only | Files / subfolders of a drive root or any folder, paginated. |

### URL shortener
| Tool | Annotation | Purpose |
|---|---|---|
| `infomaniak_list_short_urls` | read-only | Short URLs configured on a domain. |
| `infomaniak_create_short_url` | **destructive** | Two-phase create. |
| `infomaniak_delete_short_url` | **destructive** | Two-phase delete. |

### Swiss Backup
| Tool | Annotation | Purpose |
|---|---|---|
| `infomaniak_list_swiss_backups` | read-only | Swiss Backup slots on the account. |

### AI Tools
| Tool | Annotation | Purpose |
|---|---|---|
| `infomaniak_list_ai_products` | read-only | AI subscriptions the account owns. |
| `infomaniak_list_ai_models` | read-only | Public catalogue of Swiss-sovereign LLM/STT models. |

### Workflows (multi-step)
| Tool | Annotation | Purpose |
|---|---|---|
| `infomaniak_provision_site_full` | **destructive** | Site + DB + DNS in one orchestrated, plan-then-apply flow. |
| `infomaniak_audit_dns_zones` | read-only | Cross-zone audit: missing SPF/DMARC, dangling records, …. |

### Escape hatch (everything else)
| Tool | Annotation | Purpose |
|---|---|---|
| `infomaniak_api_call` | **destructive** | Reach any endpoint on `api.infomaniak.com` directly. GET runs immediately, POST/PUT/PATCH/DELETE follow the two-phase commit. Refuses paths outside the documented `/{1,2,3}/...` namespace and refuses manager-private `/proxy/...` (use a typed tool). |

## Limitations

- **Hard rate limit of 60 req/min** on `api.infomaniak.com`. The MCP throttles automatically with a token-bucket. You will see brief queueing delays on heavy bursts; this is intentional and protects your token from blacklisting.
- **No `directory` outside `/sites/`** when creating a site. Required by the manager backend (silently no-ops otherwise — see [`REVERSE-ENGINEERING.md`](./REVERSE-ENGINEERING.md#post-sites-silent-success)).
- **Manager session cookies expire** (typically every few hours / when you sign out of Chrome). Re-open [manager.infomaniak.com](https://manager.infomaniak.com) to refresh.
- **One concurrent operation per hosting** — Infomaniak rejects concurrent POSTs on the same hosting with `400 operation_in_progress`. The MCP serializes write calls per hosting.
- **WordPress installation is intentionally out of scope.** Create the empty site with this MCP, then install WP from the manager's wizard (the `applications/add` flow uses an undocumented per-step wizard that is too brittle to automate cleanly today).

## Roadmap

**Shipped in v0.7 (current)**

- ✅ Web hosting: list + create + delete sites, databases, FTP/SSH users
- ✅ DNS: full CRUD on records, DNSSEC enable/disable/check
- ✅ Mail: mailboxes, aliases, signatures, backups, redirections — all CRUD
- ✅ kDrive: list drives + browse files
- ✅ Swiss Backup: list slots
- ✅ AI Tools: list products + public model catalogue
- ✅ URL shortener: full CRUD
- ✅ Account audit: domains expiring soon, locked products, ongoing operations
- ✅ Workflow tools: `provision_site_full`, `audit_dns_zones`
- ✅ `undo` / `history` session tools
- ✅ Generic API escape hatch for any documented endpoint

**Next (v0.8+)**

- ⬜ kDrive write: upload, download, move, share, archive
- ⬜ Newsletter: campaigns, contacts (untouched today)
- ⬜ kChat: channels, threads, posts (no public API yet — needs reverse-engineering)
- ⬜ Workflow: `provision_wordpress_site` (needs a WP install path that does not depend on the brittle manager wizard)
- ⬜ Swiss Backup write: slot creation, schedules, restores
- ⬜ Per-tool happy-path tests to push coverage from 35% to 70%
- ⬜ MCPB packaging for one-click install in Claude Desktop

## FAQ

### Is this an official Infomaniak product?

No. It is community-driven, MIT-licensed, and not affiliated with, endorsed by, or sponsored by Infomaniak Network SA. See the disclaimers in [`NOTICE`](./NOTICE) and [`REVERSE-ENGINEERING.md`](./REVERSE-ENGINEERING.md).

### Does it work with clients other than Claude?

Yes. It speaks the standard [Model Context Protocol](https://modelcontextprotocol.io/) over stdio, so it works with any MCP-capable client — Claude Desktop, Claude Code, Cursor, Cline, Continue, Zed AI, and the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) for debugging.

### Will my Infomaniak token / session ever leave my machine?

No. The server runs locally over stdio. Your Bearer token is read from `INFOMANIAK_API_TOKEN` (env or `.env`) and used only to call `api.infomaniak.com`. The Chrome cookies (`SASESSION`, `MANAGER-XSRF-TOKEN`) live in memory for the duration of a single tool call and are never persisted. Logs redact every sensitive value (tokens, cookies, passwords).

### Why not on npm?

The codebase ships a few transitive dev-time dependencies (via `chrome-cookies-secure`'s native `sqlite3`) that show up on `npm audit` even after our overrides. Until that audit page is 100% clean, we prefer to ship from source so users can review the tree before installing. We will publish to npm in `v1.0`.

### Does it support self-hosting / running outside macOS?

Yes — `INFOMANIAK_AUTH_MODE=manual` lets you paste cookies straight into env vars, which is the path to use on Linux servers, Docker containers, or CI. Auto-extraction from Chrome works on macOS, Windows, and Linux when Chrome is installed locally.

### Why does site creation use a manager-private endpoint and not the public API?

Because the public `POST /1/products/{id}/web_hostings/{hid}/sites` endpoint silently returns a success response without actually creating anything. After reverse-engineering the manager bundle we found that the manager-private endpoint requires `force_fqdn: true`, `directory: /sites/...`, and `environment: apache_php` — none of which are documented. Full write-up in [`REVERSE-ENGINEERING.md`](./REVERSE-ENGINEERING.md).

### Can it install WordPress automatically?

Not today. The manager's `applications/add` flow is a multi-step wizard with per-step tokens that is brittle to script. The recommended pattern is: create the empty site with this MCP, then install WordPress (or any other CMS) from the manager wizard or by uploading via FTP/SSH.

### Is there a hosted / SaaS version?

No. By design — this server runs against your own credentials on your own machine. There is no hosted SaaS, no hosted proxy, no telemetry.

### How do I report a bug or request a tool?

Open a [GitHub issue](https://github.com/Mogacode-ma/infomaniak-mcp-agent/issues). Include the exact tool call, the input, the response (sanitized — strip tokens, cookies, customer names), and your environment (Node version, OS, MCP client, plan tier). PRs with a failing test are doubly welcome.

### What about Infomaniak's own AI Tools?

Infomaniak runs a [Swiss-sovereign AI cloud](https://www.infomaniak.com/en/ai-tools) hosting Llama, Mixtral, Whisper and other open-weights models. This MCP exposes `infomaniak_list_ai_products` and `infomaniak_list_ai_models` so an agent can discover what's available and what models are public on your account; we deliberately do not wrap their inference endpoints (use the OpenAI-compatible API directly for that).

## Contributing

Contributions are welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and follow the [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Security issues should be reported privately per [`SECURITY.md`](./SECURITY.md).

## License

[MIT](./LICENSE) — see [`NOTICE`](./NOTICE) for the trademark disclaimer.

This project is not affiliated with Infomaniak Network SA. "Infomaniak", "kDrive", "kChat", "kMeet", "kSuite", "Swiss Backup" are trademarks of Infomaniak Network SA.
