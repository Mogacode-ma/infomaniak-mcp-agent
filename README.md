# infomaniak-mcp-agent

[![CI](https://github.com/Mogacode-ma/infomaniak-mcp-agent/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Mogacode-ma/infomaniak-mcp-agent/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Mogacode-ma/infomaniak-mcp-agent/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/Mogacode-ma/infomaniak-mcp-agent/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-43853d.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-1.0-9333ea.svg)](https://modelcontextprotocol.io/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

> **Full unofficial agentic Infomaniak MCP server — guided automation of web hosting, mail, kDrive, domains and DNS.**

A [Model Context Protocol](https://modelcontextprotocol.io/) server that lets [Claude](https://www.anthropic.com/claude) (or any MCP client) drive a real Infomaniak account end-to-end: list organizations and products, audit domains and SSL, create web sites, manage mailboxes, edit DNS, and more — **54 tools** covering 14 areas, with a strict two-phase commit on every destructive operation.

## 🎒 Built in the open, in real time, by vibe-coding

This project was built rapidly by an LLM driving a terminal session ("vibe-coding"), with live tests against a real Infomaniak account at every step. **It works perfectly on the maintainer's local setup** and the full pipeline is green (typecheck strict, lint, prettier, 37 tests, build).

That said — given how it was built and given that several endpoints used here are reverse-engineered (see [`REVERSE-ENGINEERING.md`](./REVERSE-ENGINEERING.md)) — **it is entirely possible that you'll hit (potentially big) bugs** depending on your account topology, plan tier, scopes, or Infomaniak's own changes. We are here to fix them as they show up. Please:

1. Open an issue with the exact tool call, the input, the response, and your environment (Node version, OS, MCP client). Sanitize tokens / cookies / customer names before pasting.
2. Or, even better, send a PR with a failing test and we will work from there together.

We move fast and ship often. Don't be shy.

## ⚠️ Status: unofficial

This project is **not affiliated with, endorsed by, or sponsored by Infomaniak Network SA**. It is a community-driven tool that combines:

1. The **public Infomaniak API** ([api.infomaniak.com](https://developer.infomaniak.com/)), used with a Bearer token you generate yourself.
2. **Reverse-engineered manager endpoints** ([manager.infomaniak.com/proxy/...](https://manager.infomaniak.com/)), required for write operations on web hosting that the public API silently ignores.

For full transparency, read [`REVERSE-ENGINEERING.md`](./REVERSE-ENGINEERING.md). Infomaniak may change these endpoints without notice; we do our best to keep up but cannot guarantee long-term compatibility.

## Why "agentic" and not "wrapper"

Most MCP servers expose one tool per HTTP endpoint and call it a day. This one is built differently:

- **Guided dialogues** — creating a site walks you through "which organization? which hosting? root domain or subdomain? what type? recap?" instead of asking you to know the right tool to call upfront.
- **Two-phase commit** — every destructive operation returns a *plan* with a single-use confirmation token (60 s TTL). Nothing is mutated until you call back with the token.
- **Pre-flight checks** — the server checks for conflicts (existing FQDN, busy hosting, expired domain) *before* hitting the API.
- **Actionable errors** — every error tells you what happened, why, and the next step you can take.
- **Introspection** — `infomaniak_overview`, `infomaniak_help` and `infomaniak_explain` give the agent context-on-demand instead of forcing it to memorize a tool catalog.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design rationale.

## Install

> ⚠️ **Not published on npm yet.** Until v1.0, install from source.

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

### Once it lands on npm (later)

When `v1.0` is published you will be able to install with:

```bash
npm install -g infomaniak-mcp-agent
# or run on demand:
npx infomaniak-mcp-agent
```

The Claude Desktop / Claude Code configurations will then use `npx -y infomaniak-mcp-agent` instead of the absolute `node ...` path.

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

## Tools

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
| `infomaniak_create_hosting_user` | **destructive** | Two-phase create with connection_type (apache_php/ftp/sftp/nodejs). |
| `infomaniak_delete_hosting_user` | **destructive** | Two-phase revoke (files preserved). |

### DNS
| Tool | Annotation | Purpose |
|---|---|---|
| `infomaniak_dns_list_records` | read-only | Every DNS record on an Infomaniak-managed zone. |
| `infomaniak_dns_create_record` | **destructive** | Two-phase create record (A, AAAA, CNAME, MX, TXT, SRV, NS, CAA, PTR, SPF). |
| `infomaniak_dns_update_record` | **destructive** | Two-phase update (current vs proposed diff in the plan). |
| `infomaniak_dns_delete_record` | **destructive** | Two-phase delete record (with full preview before commit). |

### Mail
| Tool | Annotation | Purpose |
|---|---|---|
| `infomaniak_list_mail_hostings` | read-only | Mail hostings for one organization. |
| `infomaniak_list_mailboxes` | read-only | Mailboxes on a given mail hosting. |
| `infomaniak_get_mailbox_aliases` | read-only | Aliases configured on a specific mailbox. |
| `infomaniak_create_mailbox` | **destructive** | Two-phase create with password policy enforcement. |
| `infomaniak_delete_mailbox` | **destructive** | Two-phase delete (also wipes stored mail). |
| `infomaniak_create_mailbox_alias` | **destructive** | Two-phase add alias to a mailbox. |
| `infomaniak_list_redirections` | read-only | Server-side mail redirection rules. |
| `infomaniak_create_redirection` | **destructive** | Two-phase create rule (forward `name@…` to N targets). |
| `infomaniak_delete_redirection` | **destructive** | Two-phase delete rule. |

### kDrive
| Tool | Annotation | Purpose |
|---|---|---|
| `infomaniak_list_drives` | read-only | All kDrives the account has access to (with quota). |
| `infomaniak_list_drive_files` | read-only | Files / subfolders of a drive root or any folder, paginated. |

### AI Tools
| Tool | Annotation | Purpose |
|---|---|---|
| `infomaniak_list_ai_products` | read-only | AI subscriptions the account owns. |
| `infomaniak_list_ai_models` | read-only | Public catalogue of Swiss-sovereign LLM/STT models. |

### Escape hatch (everything else)
| Tool | Annotation | Purpose |
|---|---|---|
| `infomaniak_api_call` | **destructive** | Reach any endpoint on `api.infomaniak.com` directly. GET runs immediately, POST/PUT/PATCH/DELETE follow the two-phase commit. Refuses paths outside the documented `/{1,2,3}/...` namespace and refuses manager-private `/proxy/...` (use a typed tool). |

More tools (kDrive, newsletters, swiss-backup, kchat, undo, history, …) are coming — see the [roadmap](#roadmap).

## Limitations

- **Hard rate limit of 60 req/min** on `api.infomaniak.com`. The MCP throttles automatically with a token-bucket. You will see brief queueing delays on heavy bursts; this is intentional and protects your token from blacklisting.
- **No `directory` outside `/sites/`** when creating a site. Required by the manager backend (silently no-ops otherwise — see [`REVERSE-ENGINEERING.md`](./REVERSE-ENGINEERING.md#post-sites-silent-success)).
- **Manager session cookies expire** (typically every few hours / when you sign out of Chrome). Re-open [manager.infomaniak.com](https://manager.infomaniak.com) to refresh.
- **One concurrent operation per hosting** — Infomaniak rejects concurrent POSTs on the same hosting with `400 operation_in_progress`. The MCP serializes write calls per hosting.
- **WordPress installation is intentionally out of scope.** Create the empty site with this MCP, then install WP from the manager's wizard (the `applications/add` flow uses an undocumented per-step wizard that is too brittle to automate cleanly today).

## Roadmap

- [x] Web hosting: list + create sites
- [ ] Web hosting: list + create databases, FTP users, redirects, crons
- [ ] DNS: full CRUD on records, DNSSEC management
- [ ] Mail: mailboxes, aliases, autoresponders, signatures, backups
- [ ] kDrive: list, share, upload, download, archive
- [ ] Newsletter: campaigns, contacts
- [ ] Swiss Backup: slots, schedules
- [ ] Account audit: domains expiring soon, SSL near-expiration, mailbox quotas
- [ ] `undo` / `history` tools
- [ ] Workflow tools: `provision_wordpress_site`, `migrate_site`, `audit_account`

## Contributing

Contributions are welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and follow the [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Security issues should be reported privately per [`SECURITY.md`](./SECURITY.md).

## License

[MIT](./LICENSE) — see also the trademark notice in `LICENSE`.

This project is not affiliated with Infomaniak Network SA. "Infomaniak", "kDrive", "kChat", "kMeet", "kSuite", "Swiss Backup" are trademarks of Infomaniak Network SA.
