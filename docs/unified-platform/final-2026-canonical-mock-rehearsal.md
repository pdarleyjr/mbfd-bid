# Final-source canonical Mock rehearsal

This is the reproducible validation contract for the complete source-derived definition. Execution results belong to the private run report and exact-candidate logs. This document does not approve real Bid activation or claim browser/Durable Object runtime acceptance.

## Bound source and expected outcome

- Private source artifact: `tmp/unified-platform/final-release-continuation-20260919/source-review/final-canonical-definition.json`.
- Required artifact SHA-256: `f91e4a146620327accfdeb37be2ff0345e9d9ffa06c14d37365b354b2fd0c402`.
- Entire topology: **228 positions** and its source-derived profiles, concrete rules, pool order, and reviewed clauses.
- Applicable award coverage: **223 positions**. Four Days positions remain closed; the Union position remains excluded.
- Expected final outcome: 223 canonical awards, verified canonical Mock completion, read-only Results and rehearsal Department projection, zero legacy `bids` inserts, and zero Department `member_assignments` inserts.

The test creates input facts only. It never seeds a completed run, command receipt, or award. It saves the definition through the current Bid HTTP facade, previews and creates Mock, starts it, and executes the canonical command API through every applicable stage. The loopback Durable Object transport invokes the production canonical service; the actual Worker HTTP adapters retain actor, eligibility, fallback, and specialty-candidate authority.

The scenario covers DC pre-staging, Days and shift officer stages, Firefighter selections, minimum-qualification rejection, the Investigator IAAI preference interruption, immutable pool slot allocation, server-ordered forced DE fallback, contact evidence and defer/return, a Captain amendment, closed Days terms, simultaneous A-Day selection, and final Results/rehearsal projection. It retains explicit negative checks for missing A-Day, separate SWAT A-Days, the DE limit, Marine core separation, and combined Marine core/float capacity. Ordinary A-Day proposals reuse `evaluateFrozenSimultaneousADays`, the canonical server evaluator, and all accepted awards still pass the canonical command guard. The separate eight-member mechanism test covers protected-incumbent term departure and its recorded voluntary election.

## Synthetic activation assumptions

The saved rehearsal copy supplies facts that the source draft intentionally leaves unresolved:

- One synthetic member per applicable position, exact minimum credential tokens, explicit synthetic Rescue service evidence, and an immutable synthetic Bid ordinal dataset. No seniority dates are invented from ordinal ranks.
- One synthetic IAAI-certified contender to exercise the source preference hierarchy.
- Synthetic operator grants, January 2027 evaluation dates, and a two-day session duration.
- A synthetic DC pre-stage and explicit stage member sets, with source ordinal ordering preserved.
- Synthetic general A-Day capacity where the source draft has no approved limit. Known DE, Marine, and SWAT restrictions remain enforced.
- Six synthetic reviewed existing SWAT members, two per shift with distinct A-Days. This is one rehearsal assumption, not resolution of the real SWAT candidate-population question.
- Synthetic approved staffing bindings and vacant/unprotected tenure input records. The source's closed Days positions remain closed.
- Pending source decisions resolved **only inside the isolated synthetic copy**, with explicit rehearsal provenance. The original source artifact remains unchanged.

## Reproduction

From the repository root in PowerShell, after building the shared/eligibility packages:

```powershell
$env:MBFD_FINAL_MOCK_SOURCE = Join-Path (Get-Location) 'tmp/unified-platform/final-release-continuation-20260919/source-review/final-canonical-definition.json'
$env:MBFD_FINAL_MOCK_SOURCE_SHA256 = 'f91e4a146620327accfdeb37be2ff0345e9d9ffa06c14d37365b354b2fd0c402'
$env:MBFD_FINAL_MOCK_REPORT = Join-Path (Get-Location) 'tmp/unified-platform/final-release-continuation-20260919/source-review/full-canonical-mock-report.json'
pnpm --dir apps/worker exec vitest run tests/integration/canonical-final-source-mock.test.ts --silent
```

This test is intentionally skipped without the private source input; a default suite pass therefore does not prove the full-source rehearsal. A hash mismatch fails before execution. The report is written only after completion, award-count, Results, projection, database immutability, and zero-production-assignment checks pass. It records the source digest, saved version/content digest, synthetic run identifier, command attempts, transport boundary, and assumptions. The `.progress` file is a diagnostic checkpoint, not completion evidence.

The integration test uses local SQLite behind the D1 adapter. It does not establish production D1 behavior, real Durable Object eviction/concurrency acceptance, browser acceptance, external publication, real personnel readiness, or authority to start Live. Those remain separate release gates.
