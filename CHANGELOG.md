# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added (v0.2 work-in-progress)
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
