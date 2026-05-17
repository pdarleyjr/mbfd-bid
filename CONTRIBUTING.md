# Contributing

This is an internal MBFD project. Contributions are limited to authorized
maintainers.

## Development workflow

1. Create a feature branch off `main`:
   ```bash
   git checkout -b feat/<short-description>
   ```
2. Follow the active plan in `MBFD_Hub/docs/superpowers/plans/`. Each task in
   a plan is TDD-ordered: write the failing test → minimal impl → tests pass
   → commit.
3. Commit using Conventional Commits:
   ```
   feat:  new feature
   fix:   bug fix
   refactor: code change with no behavior change
   docs:  documentation only
   test:  test-only change
   chore: tooling/dependency change
   perf:  performance improvement
   ci:    CI configuration change
   ```
4. Push and open a Pull Request to `main`.

## Pull Request requirements

Every PR must:

- [ ] Pass CI (lint, typecheck, unit, integration, E2E)
- [ ] Maintain ≥ 80% line and branch coverage
- [ ] Reference the plan task it implements (e.g., "Plan 01 / Task 7")
- [ ] Have a clear description per `.github/PULL_REQUEST_TEMPLATE.md`
- [ ] Receive at least one approval from a code owner
- [ ] Be merged via squash with PR title as the commit subject
- [ ] Resolve all review conversations

`main` is protected: force pushes are blocked, deletions are blocked, linear
history is required.

## Code style

- Biome handles formatting and linting. Run `pnpm lint:fix` before pushing.
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. No `any`.
- Zod-first validation at every boundary (API, env, DB row, WS message).
- Files target 200–400 lines, 800 max. Split by responsibility.
- Tests live next to source under `tests/` mirroring `src/`.

## Design system rules

The UI must honor the rules in `MBFD_Hub/.impeccable.md`. Specifically:

- Red is `red-700` only. No other reds.
- No cold grays (`gray-*`, `slate-50`). Use `stone-*`.
- All numeric data carries `font-variant-numeric: tabular-nums`.
- Touch targets ≥ 44×44px on `(hover: none)` media.
- All transitions gated by `prefers-reduced-motion`.
- Plus Jakarta Sans (headings), Source Sans 3 (body), JetBrains Mono (IDs).

CI lints enforce these where mechanizable; reviewers enforce the rest.

## Security

If you find a vulnerability, see [`SECURITY.md`](SECURITY.md). Do not file
public issues for security matters.

## Questions

DM `@pdarleyjr` or open a Discussion. Issues are for tracked work.
