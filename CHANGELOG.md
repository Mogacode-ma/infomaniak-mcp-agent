# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/mogacode/infomaniak-mcp-agent/commits/main
