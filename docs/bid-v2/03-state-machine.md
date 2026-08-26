# MBFD Bid v2 live-state-machine contract

## Authority

The Durable Object/session command handler is the realtime coordination boundary. D1 remains the durable record. Browser state is a projection and may not invent a successful mutation.

## Required state dimensions

- Session identity, mode (`mock` or live), phase, and canonical sequence number.
- Input snapshot identifiers and policy/eligibility freeze state.
- Current turn, ordered/deferred bidders, specialty interruption stack, and disputes/holds.
- Opportunity status, awards, A-Day state, and explicit publication state.
- Viewer projection status (`active`, `paused`, or `blank`) once a public view is designed.

## Command requirements

Every consequential command must include an authenticated actor, command/idempotency identifier, expected state/sequence where relevant, reason/override evidence where required, and an audit result.

Commands must reject rather than silently compensate for:

- stale or disconnected client state;
- invalid phase transition;
- missing frozen inputs;
- unauthorized or expired step-up authority;
- unavailable/invalid opportunity;
- policy blocker that affects the proposed action.

## Client reconnect contract

1. A disconnected socket sets `connectionStatus` to a non-sendable state.
2. The UI disables consequential actions and clearly says that no command was sent.
3. Reconnection fetches or receives a canonical snapshot with the sequence number.
4. The client reconciles pending UI state only from canonical acknowledgement/event evidence.
5. A reconnect never turns an unsent optimistic selection into an award.

## Deferred state-machine work

Specialty interruption/recall, disputes, public blanking, and Durable Object deploy/recovery semantics require dedicated test contracts before implementation changes.
