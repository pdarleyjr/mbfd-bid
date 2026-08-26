# MBFD Bid v2 live-state-machine contract

## Authority

The Durable Object/session command handler is the required realtime coordination boundary. D1 remains the durable record. Browser state is a projection and may not invent a successful mutation. The current implementation has not yet made that boundary the authoritative live policy evaluator, so it is not an accepted live-command path.

## Required state dimensions

- Session identity, mode (`mock` or live), phase, and canonical sequence number.
- Input snapshot identifiers and policy/eligibility freeze state.
- Current turn, ordered/deferred bidders, specialty interruption stack, and disputes/holds.
- Opportunity status, awards, A-Day state, and explicit publication state.
- Viewer projection status (`active`, `paused`, or `blank`) once a public view is designed.

## Required live-command contract (not met by the current direct-D1/HTTP paths)

Every consequential command must include an authenticated actor, command/idempotency identifier, expected state/sequence where relevant, reason/override evidence where required, and an audit result.

Commands must reject rather than silently compensate for:

- stale or disconnected client state;
- invalid phase transition;
- missing frozen inputs;
- unauthorized or expired step-up authority;
- unavailable/invalid opportunity;
- policy blocker that affects the proposed action.

## Live-start readiness boundary

The directive's 16 readiness facts are represented by a shared, data-only evaluator. An omitted fact is `NOT_CONFIGURED`, duplicate facts are `BLOCKING`, and either state prevents a live start. The current Worker has no verified providers for all of those facts, so a non-mock `POST /api/admin/bid-session/:id/start` returns `409 readiness_blocked`; it does not write D1 or an audit row.

Mock rehearsals remain available to exercise the existing behavior. A session can be designated mock only with fresh step-up authority while it is still in `config` and has no picks; the route then attempts a separate audit-log write. State/audit transactional coupling and audit-chain verification are not established. They are not evidence that a live start is safe. In particular, the live route has not yet created an immutable input snapshot or initialized the Durable Object before an authoritative transition. Those gaps remain release blockers rather than conditions to bypass.

### Rehearsal command-boundary proof

`POST /api/admin/rehearsal/:sessionId/commands/freeze` is a deliberately
mock-only proof path. It requires fresh admin step-up authority, reads the
existing `is_mock` designation before contacting the named Durable Object, and
forwards a typed command with a UUID command identifier and expected DO
sequence. Acceptance means only that the DO-local state and private command
receipt committed together. It does not project `bid_sessions` freeze columns,
does not establish D1/R2 audit atomicity, and does not create a live command
path. A rehearsal reset clears DO receipts and remains separately best-effort
across D1 and the DO.

The current Durable Object member-pick handler also receives an always-eligible placeholder instead of a decoded, frozen rule book. The HTTP policy guards do not make that handler safe by implication. A canonical live command must either evaluate a verified snapshot in the DO or delegate to a guarded Worker command before any live enablement.

## Client reconnect contract

1. A disconnected socket sets `connectionStatus` to a non-sendable state.
2. The UI disables consequential actions and clearly says that no command was sent.
3. Reconnection fetches or receives a canonical snapshot with the sequence number.
4. The client reconciles pending UI state only from canonical acknowledgement/event evidence.
5. A reconnect never turns an unsent optimistic selection into an award.

## Deferred state-machine work

Specialty interruption/recall, disputes, public blanking, and Durable Object deploy/recovery semantics require dedicated test contracts before implementation changes.
