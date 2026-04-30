# Security policy

## Reporting a vulnerability

If you discover a security issue in `infomaniak-mcp-agent`, please **do not** open a public GitHub issue. Instead, send the details privately:

- **Email**: open an issue marked "private security report" on GitHub if no email is published yet, and we will reach out.
- **GitHub Security Advisory**: use the [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability) feature on this repo when available.

We will respond within 5 business days with an acknowledgment, and within 30 days with a fix or a disclosure timeline.

## Scope

We treat as in-scope:

- **Credential leakage** in source, logs, error messages, or stack traces — including patterns that could leak `SASESSION`, `MANAGER-XSRF-TOKEN`, the public API token, or `.env` contents.
- **Privilege escalation** that lets a tool perform an action the user did not confirm (e.g. bypassing the two-phase commit token check).
- **Supply chain weaknesses** in the dependency graph, including typosquatting risks.
- **Confused-deputy** issues where an operation runs against the wrong account or hosting.
- **Unsafe defaults** — any configuration that exposes credentials or bypasses confirmation by default.

Out of scope:

- Issues stemming from running the MCP against an account whose credentials have already been compromised by other means.
- Bugs in Infomaniak's own services. Please report those to Infomaniak directly.
- Performance issues unless they enable denial-of-service against the local machine.

## What we do internally

- **No credential is ever logged**: our pino instance redacts every known sensitive path (see `src/utils/logger.ts → REDACT_PATHS`).
- **No credential is ever persisted by the package**: cookies extracted from Chrome live in memory only.
- **Two-phase commit for destructive operations**: see [`ARCHITECTURE.md` § 4](./ARCHITECTURE.md).
- **Dependency hygiene**: `npm audit --audit-level=high` is run in CI on every PR.
- **Secret scanning**: `gitleaks` is run as a pre-commit hook and in CI to prevent accidental commits of tokens.

## What you should do as a user

- Generate a **dedicated** Infomaniak Bearer token for this MCP, with a sensible expiry and a recognizable label. Revoke it from [manager.infomaniak.com](https://manager.infomaniak.com/v3/ng/profile/user/token/list) the moment you stop using the MCP.
- Keep your `.env` out of version control (the `.gitignore` already excludes it; do not override).
- If you operate multiple Infomaniak accounts (e.g. you are a partner), be intentional about which token is configured. The MCP's `infomaniak_overview` will show every account the token can reach.
- Treat the manager-private cookies (SASESSION, MANAGER-XSRF-TOKEN) as session-bound: signing out of [manager.infomaniak.com](https://manager.infomaniak.com) is the cleanest way to invalidate them when leaving a shared machine.
- **Never** copy/paste a real token, cookie value, or production payload into a public issue, gist, screenshot, or log dump.
