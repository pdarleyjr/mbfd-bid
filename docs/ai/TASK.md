# MBFD Bid V2 checkpoint

## Objective

Checkpoint the completed local control-plane hardening candidate.

## Scope

Migrations 0036/0037, receipt recovery, specialty mutual exclusion, WebSocket reconnect, and their regression coverage.

## Non-goals and boundaries

No staging, production, portal publication/writeback, GitHub Actions, remote D1, deployment, MBFD Hub, Media Control, GMKtec, Docker, Tunnel, or DNS change.

## Acceptance criteria

Local deterministic gates, managed local D1 proofs, native Linux/OpenNext root-200 proof, and a P0/P1-free read-only review.

## Required validation

Frozen install, lint, builds, typecheck, full suite, D1 backup preflight, migration integrity, dependency audit, and diff/secret/PII/artifact inventory.

## Next completion boundary

Read-only Terra High P0/P1 checkpoint review, then one local commit only if no blocking finding exists.
