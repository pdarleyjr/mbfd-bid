# Wrangler tail PII audit (Plan 09 Task 1)

Updated: 2026-08-27 (request-log re-audit).

## Goal

Confirm that no Worker log line contains raw PII under normal traffic.
Forbidden tokens:

- Raw employee IDs (5-digit numeric)
- Raw IPv4 addresses
- PINs (`PIN.*\d{4}`)
- Authorization / Bearer headers

## Methodology

Phase A is local + staging-code-only — no production tail capture is run by
this hardening pass. Instead, this audit is a **static source inspection** of
every emitter call (`console.log|info|warn|error`, `logger(...)`) in
`apps/worker/src` and the third-party loggers wired into the request path.

The same `Select-String` greps in the plan can be re-run against a real
staging `wrangler tail --format json` capture before any prod traffic. The
audit confirms no source-level violations exist today — i.e., a future tail
capture should also come back clean.

## Static inventory of all log call sites

Generated via `Grep -n 'console\.(log|info|warn|error)' apps/worker/src`.
Total: 19 emitter sites. None log raw PII.

| # | File | Line | Form | PII risk |
|---|------|------|------|----------|
| 1 | `src/scheduled.ts` | 77 | `console.info('[portal-reconciliation]', result)` — `result` is `{ reEnqueued, failedBidCount, ranAt }` (counts only) | none |
| 2 | `src/index.ts` | 97 | `console.error('[worker error]', err)` — Error object; stack may include file paths but not request body | none (stack frames are code paths, not user data) |
| 3-6 | `src/durable/bid-session.ts` | 162, 168, 526, 551, 619 | `console.error('[BidSessionDO] ... ', err)` — prefix string + thrown error; no member/employee identifiers in the message | none |
| 7 | `src/portal-writeback/reconciliation.ts` | 36 | `console.error(`[portal-reconciliation] reEnqueue failed for ${r.id}`, err)` — `r.id` is a ULID queue-row ID, not PII | none |
| 8 | `src/portal-writeback/queue-handler.ts` | 93 | ``console.warn(`[portal-writeback] bid ${bidId} not found; acking as mock`)`` — `bidId` is a ULID | none |
| 9 | `src/portal-writeback/queue-handler.ts` | 98 | `console.error('[portal-writeback] is_mock lookup failed', err)` | none |
| 10 | `src/portal-writeback/queue-handler.ts` | 114 | ``console.info(`[portal-writeback] skipping mock session ${body.payload.bid_session_id} bid ${body.bidId}`)`` — both IDs are ULIDs | none |
| 11 | `src/portal-writeback/queue-handler.ts` | 124 | `console.error('[portal-queue] handleMessage threw — letting CF retry once', err)` | none |
| 12 | `src/routes/auth.ts` | 64 | `console.error('[auth.login] portal error', err)` — error from portal HTTP call; portal-client (Plan 02) never throws the request body | none |
| 13 | `src/routes/admin/rehearsal.ts` | 151 | `console.error('[rehearsal] DO reset-mock call failed (best-effort)', err)` | none |
| 14-19 | `src/ai/eval/replay-2025.ts`, `src/ai/prompts/rulebook-codegen.ts` | (offline scripts) | Build-time only; never reach the Worker runtime | none |

## Third-party loggers

### `hono/logger` with whole-query redaction

`apps/worker/src/index.ts` supplies every Hono logger message to
`src/lib/request-log.ts:redactRequestLog`. It replaces the entire query
string with `?<redacted>` before `console.log`, preserving only the method,
path, status, and elapsed time. This is intentional defense in depth because
both the browser WebSocket fallback and roster-print flow can carry a
reusable bearer token in a query string (the current default JWT lifetime is
eight hours).

The covered path components in this worker are:

- `/api/auth/login` — employee_id is in the **JSON body**, not the URL → safe.
- `/api/admin/...` — admin routes carry ULID session IDs and shift letters
  in the URL → safe.
- `/api/ws/session/:id` — `:id` is a ULID; any `?token=` value is redacted.

`tests/unit/request-log.test.ts` covers both ordinary and percent-encoded
parameter names and asserts that the emitted application logger output never
contains the query value. This does not prove Cloudflare platform logging
configuration; that remains a separate hosted-observability check.

### `cf-connecting-ip` header

The header IS read in `apps/worker/src/middleware/rate-limit.ts` (Task 3) for
KV bucket keying — and `rate-limit.ts` SHA-256 hashes the IP before storing
it. The raw IP is never `console.log`'d. The KV key prefix is `rl:ip:<16-hex>`
which is irreversible.

## Findings

**No known source-level query-token leak remains in the application logger.**
The logger redaction and its regression test are the current source evidence.

The four forbidden-token greps from the plan would all return zero hits on
both:

1. A live staging `wrangler tail` capture, AND
2. A `git grep` over `apps/worker/src` for any emitter that interpolates an
   employee ID, name, IP, PIN, or `Authorization` value.

This audit is repeatable: re-running the static inspection and
`tests/unit/request-log.test.ts` any time a new log emitter or query-token
path is added is the source gate. If a future review surfaces a violation,
the redaction pattern is the structured-log shape in the plan:

```ts
console.info(JSON.stringify({ traceId, userId: ulid, route, latencyMs, outcome }));
```

## Re-audit checklist before each rehearsal

1. `Grep -rn 'console\.(log|info|warn|error)' apps/worker/src` — inspect
   every new emitter and confirm request logging still uses whole-query
   redaction.
2. Run `pnpm --filter @mbfd/worker exec vitest run --config vitest.config.ts tests/unit/request-log.test.ts`.
3. Run a staging `wrangler tail --format json` capture for 10 minutes during
   a happy-path test, save to `tail-staging-<date>.jsonl`, run the four
   `Select-String` greps from the plan, confirm all four return zero hits.

## Conclusion

Source redaction is verified locally; hosted tail evidence is still required
before asserting that Cloudflare-side observability also omits query values.
