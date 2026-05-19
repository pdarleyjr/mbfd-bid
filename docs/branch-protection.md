# Branch protection on `main` (Plan 09 Task 8)

Updated: 2026-05-19.

## Required status checks

A PR may merge to `main` only if all of these checks pass:

- **Lint + Typecheck** — `ci.yml > lint-and-typecheck`
- **Unit + Integration** — `ci.yml > unit-and-integration`
- **Playwright E2E** — `ci.yml > e2e`

The names above are the **exact** GitHub Actions job names. They must match
the strings used in the branch-protection API call below.

## Configuration via `gh` CLI

Run from a workstation with `gh auth status` showing logged in as an
account with admin rights on `pdarleyjr/mbfd-bid`:

```powershell
$owner = (gh repo view --json owner -q .owner.login)
$repo  = (gh repo view --json name  -q .name)
gh api -X PUT "repos/$owner/$repo/branches/main/protection" `
  -F required_status_checks.strict=true `
  -F 'required_status_checks.contexts[]=Lint + Typecheck' `
  -F 'required_status_checks.contexts[]=Unit + Integration' `
  -F 'required_status_checks.contexts[]=Playwright E2E' `
  -F 'required_pull_request_reviews.required_approving_review_count=1' `
  -F 'required_pull_request_reviews.dismiss_stale_reviews=true' `
  -F enforce_admins=true `
  -F 'restrictions=' `
  -F allow_force_pushes=false `
  -F allow_deletions=false `
  -F required_linear_history=true
```

Verify with:

```powershell
gh api "repos/$owner/$repo/branches/main/protection" | ConvertFrom-Json | Format-List
```

Expected: `required_status_checks.contexts` lists all three; `enforce_admins.enabled = True`.

## Rollback (emergency only)

```powershell
gh api -X DELETE "repos/$owner/$repo/branches/main/protection"
```

Do **not** run this except during a genuine emergency. The cutover gate
requires the rule to be in place.

## Phase A status

This document is the authoritative record. The actual API call is part of
the **operator runbook** — Phase A is local + staging-code-only, so the
branch protection rule is configured by the operator running the `gh api`
command above out-of-band, not by a CI job.

The CI job names in `ci.yml` HAVE been verified to match the
`required_status_checks.contexts[]` strings above, so the operator can run
the command exactly as written.

## Auditing the rule on demand

Anyone with read access to the repo can confirm the rule is active:

```powershell
gh api "repos/pdarleyjr/mbfd-bid/branches/main/protection" `
  --jq '{
    required_checks: .required_status_checks.contexts,
    enforce_admins: .enforce_admins.enabled,
    linear: .required_linear_history.enabled,
    review_count: .required_pull_request_reviews.required_approving_review_count
  }'
```
