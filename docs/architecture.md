# MBFD Bid architecture

The production Web Worker at `https://bid.mbfdhub.com` serves the Next.js/OpenNext UI and same-origin authenticated proxy. The API Worker at `https://api.bid.mbfdhub.com` owns validated commands, the canonical BidSession Durable Object, D1, KV and R2. The normal Hub authorization-code flow uses `https://www.mbfdhub.com/auth/bid/authorize` and returns to `https://bid.mbfdhub.com/api/auth/callback`.

Canonical bid commands carry expected sequence, stable idempotency and saved authority. Frozen source/definition receipts, accepted command events and audited compensating corrections remain immutable. Department staffing, source ingestion and annual Bid configuration reuse their existing services; previous-year history is documentary context rather than current seat authority.

The dedicated `apps/worker/wrangler.test.toml` is local-only test configuration. It has fake resource identifiers, a reserved synthetic Hub origin and no production bindings, custom domains, queues or cron. Browser fixtures and runtime checks remain distinct from real authenticated production acceptance.

Production release is manual and pins one full immutable SHA. It keeps the separately controlled D1 migration ledger, fresh private backup/recovery evidence and Worker-first health gate. Portal writeback remains disabled; read-only Hub federation does not grant publication authority.

The obsolete deployment was retired on 2026-10-01. See [the retirement boundaries](staging-retirement-20261001.md).
