<!-- Thank you for opening a PR. Please fill in the sections below. -->

## What

Briefly describe what this PR does.

## Why

Explain the motivation and link any related issues. PRs without a stated purpose are hard to review.

## How

If non-trivial, describe the approach. If you added or changed an Infomaniak endpoint, point to the line in `REVERSE-ENGINEERING.md` you updated.

## Checklist

- [ ] `npm run lint` passes (no warnings)
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `npm run build` succeeds
- [ ] No secrets committed (gitleaks pre-commit hook ran)
- [ ] If a destructive tool was added or changed, the two-phase commit pattern is preserved
- [ ] If a new Infomaniak endpoint is used, it is documented in `REVERSE-ENGINEERING.md`
- [ ] User-facing changes are reflected in `README.md` and `CHANGELOG.md`
