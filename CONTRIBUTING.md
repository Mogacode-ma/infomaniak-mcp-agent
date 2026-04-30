# Contributing

Thank you for considering a contribution. This document tells you what you need to know before opening a PR.

## Ground rules

1. **Never commit credentials.** A `gitleaks` pre-commit hook scans every staged change. Configuration: `.gitleaks.toml`. If you trip it, fix the leak before pushing. Do not pretend "it's just a test value" — it isn't.
2. **Strict TypeScript.** `tsconfig.json` has every strict flag on (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, etc.). No `any`. No `@ts-ignore` without an issue link.
3. **Validate at the boundary.** Inputs from the MCP client and outputs of the Infomaniak API should both go through Zod schemas. Internal type assertions are fine; data crossing module boundaries is not.
4. **Honest reverse-engineering only.** New undocumented endpoints must be added to [`REVERSE-ENGINEERING.md`](./REVERSE-ENGINEERING.md) with their discovery method. No "I just got this from somewhere".
5. **No silent failures.** Every catch must either rethrow or escalate to a typed `InfomaniakError`. No `catch (e) {}`.

## Local setup

```bash
git clone <fork-url> infomaniak-mcp-agent
cd infomaniak-mcp-agent
npm ci
cp .env.example .env  # fill in your own credentials — they stay local
npm run typecheck
npm run lint
npm run test
npm run build
```

For interactive testing of MCP tools:

```bash
npm run inspector  # opens the MCP Inspector against your local build
```

## Workflow

1. **Open an issue first** for any non-trivial change (new tool, new endpoint, breaking refactor). Discussing the design before code saves everyone time.
2. **Branch off `main`**: `feat/...` for features, `fix/...` for bug fixes, `docs/...` for documentation, etc.
3. **Conventional Commits.** Commit messages follow the [Conventional Commits](https://www.conventionalcommits.org/) spec. The commitlint hook enforces this.

   ```
   feat(tools): add infomaniak_list_databases
   fix(throttle): release waiters on AbortError
   docs(reverse-engineering): document /proxy/1/.../tools/restore_backups
   ```
4. **Tests for everything you touch.** New tools need at least:
   - An input-validation test (Zod rejects bad input).
   - A happy-path test against a mocked HTTP server (msw).
   - An error-path test for the most likely failure (auth, validation, rate limit).
5. **Run all checks locally** before pushing: `npm run lint && npm run typecheck && npm run test && npm run build`.
6. **Open a PR** describing the *why* in the description (not just the *what*). Link the issue. Mention any new endpoint added to `REVERSE-ENGINEERING.md`.

## Adding a new tool

1. Create `src/tools/<feature>.ts` that exports a `ToolDefinition`.
2. Add it to the array in `src/tools/index.ts`.
3. Document it in the README's tools table.
4. Add tests under `tests/tools/<feature>.test.ts`.
5. If the tool is destructive, follow the two-phase-commit pattern shown in `src/tools/sites.ts → createSiteTool` (mint token, document plan, consume on apply, never bypass the fingerprint check).

## Adding a new endpoint

1. Add the URL pattern to `REVERSE-ENGINEERING.md` with its discovery source.
2. If it returns structured data, add a Zod schema to `src/types/infomaniak.ts`.
3. Use `PublicApiClient` for `api.infomaniak.com/...` and `ManagerApiClient` for `manager.infomaniak.com/proxy/...`.

## Code style

We rely on automated tooling (ESLint + Prettier + commitlint) for everything that can be automated. Beyond that, please follow these editorial guidelines:

- **TSDoc comments** on every exported symbol describing intent, edge cases, and side effects. Avoid restating the type (that's already in the signature).
- **Imperative verbs** in tool names (`infomaniak_list_sites`, `infomaniak_create_site`). No mixed tenses.
- **No magic numbers.** If a number has meaning (Infomaniak rate cap, token TTL, …), name it as a constant or load it from config.
- **Errors over booleans.** When a function can fail, throw a typed error. Don't return `false` and let callers guess.

## Questions

Open a discussion on GitHub. We aim to reply within a week. Real-time chat is not available; please be patient.
