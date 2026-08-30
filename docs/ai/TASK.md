# MBFD Bid V2 checkpoint

## Objective

Checkpoint the Cloudflare Vitest / Durable Object reliability candidate.

## Scope

Workers Vitest v1 migration, genuine Durable Object eviction, and standard-WebSocket recovery coverage.

## Non-goals and boundaries

No staging, production, portal publication/writeback, GitHub Actions, remote D1, deployment, MBFD Hub, Media Control, GMKtec, Docker, Tunnel, or DNS change.

## Acceptance criteria

Local deterministic gates, managed local D1 proofs, native Linux/OpenNext root-200 proof, and a P0/P1-free read-only review.

## Required validation

Frozen install, lint, builds, typecheck, full suite, D1 backup preflight, migration integrity, dependency audit, and diff/secret/PII/artifact inventory.

## Next completion boundary

Reliability checkpoint complete; the next task is a separate staging D1 migration-risk review.
