# CodeQL high-severity triage (Plan 09 Task 2)

Updated: 2026-05-19 (Plan 09 Phase A — investigatory).

## Goal

Every Critical and High severity CodeQL alert on `main` is either fixed or
closed with a documented suppression reason.

## Query

```text
gh api "repos/pdarleyjr/mbfd-bid/code-scanning/alerts?state=open&severity=critical"  → []
gh api "repos/pdarleyjr/mbfd-bid/code-scanning/alerts?state=open&severity=high"      → []
gh api "repos/pdarleyjr/mbfd-bid/code-scanning/alerts?state=open&severity=error"     → []
gh api "repos/pdarleyjr/mbfd-bid/code-scanning/alerts?state=open"                    → 1 alert
```

## Findings

**Zero Critical / High / Error severity alerts open on `main`.**

The single open alert is `note`-severity and informational only.

### Alert inventory

| # | Rule | Severity | Path | Line | Decision | Reason |
|---|------|----------|------|------|----------|--------|
| 1 | `js/unused-local-variable` | note | `apps/worker/tests/unit/cors.test.ts` | 1 | leave open | Test fixture import — Biome already flags this via lint warnings (one of the 7 pre-existing warnings). Removing it changes the runtime behavior of the CORS unit test (the import was deliberate to assert tree-shake behavior of the bare `Hono` reference). Not a security finding. |

## Workflow status

```text
gh workflow run codeql.yml --ref main  (next run scheduled by CI)
```

The CodeQL workflow is `.github/workflows/codeql.yml`; it runs on every PR
to `main` and on a weekly cron. There are no failures in recent runs.

## Conclusion

No fix required for Task 2. Doc-only commit lands the triage log. Phase E
cutover gate is "zero Critical/High CodeQL alerts" — that gate is already
satisfied as of 2026-05-19.

## Re-audit checklist before each rehearsal

1. `gh api "repos/pdarleyjr/mbfd-bid/code-scanning/alerts?state=open&severity=critical"` — must return `[]`.
2. `gh api "repos/pdarleyjr/mbfd-bid/code-scanning/alerts?state=open&severity=high"` — must return `[]`.
3. `gh api "repos/pdarleyjr/mbfd-bid/code-scanning/alerts?state=open&severity=error"` — must return `[]`.

If any of those return non-empty, the cutover is blocked until the alerts
are fixed or dismissed with a documented reason in this log.
