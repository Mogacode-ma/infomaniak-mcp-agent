# infomaniak-mcp-agent

> **Full unofficial agentic Infomaniak MCP server — guided automation of web hosting, mail, kDrive, domains and DNS.**

A [Model Context Protocol](https://modelcontextprotocol.io/) server that lets [Claude](https://www.anthropic.com/claude) (or any MCP client) drive a real Infomaniak account end-to-end: list organizations and products, audit domains and SSL, create web sites, manage mailboxes, edit DNS, and more.

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

```bash
npm install -g infomaniak-mcp-agent
```

Or run on demand without installing:

```bash
npx infomaniak-mcp-agent
```

### Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%AppData%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "infomaniak": {
      "command": "npx",
      "args": ["-y", "infomaniak-mcp-agent"],
      "env": {
        "INFOMANIAK_API_TOKEN": "paste-your-token-here",
        "INFOMANIAK_AUTH_MODE": "auto"
      }
    }
  }
}
```

### Configure Claude Code

```bash
claude mcp add infomaniak \
  -e INFOMANIAK_API_TOKEN=paste-your-token-here \
  -e INFOMANIAK_AUTH_MODE=auto \
  -- npx -y infomaniak-mcp-agent
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

## Tools

| Tool | Annotation | Purpose |
|---|---|---|
| `infomaniak_overview` | read-only | Summary of organizations + products. Best first call. |
| `infomaniak_list_organizations` | read-only | Accounts you have technical access to. |
| `infomaniak_list_hostings` | read-only | Web hostings (classic + Node.js) for one organization. |
| `infomaniak_list_sites` | read-only | Sites on a given web hosting (with applications). |
| `infomaniak_create_site` | **destructive** | Two-phase: returns a plan + token, second call with token actually creates. |

More tools (mail, dns, drive, domain, audit, undo, …) are coming — see the [roadmap](#roadmap).

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
