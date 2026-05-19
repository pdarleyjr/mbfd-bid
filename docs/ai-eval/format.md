# 2025 bid replay — eval report format

This file documents the schema for `docs/ai-eval/2025-replay.md`, the output
of `apps/worker/src/ai/eval/replay-2025.ts` (Plan 06 Task 19).

## Sections

1. **Summary**
   - Total picks replayed
   - Top-1 match rate (%)
   - Top-3 match rate (%)
   - Avg cost per call (cents)
   - Avg latency per call (ms)
   - Total spend ($)
2. **Top dissent cases** (10 rows)
   - pick ordinal | employee_id | actual position | AI top pick | AI reasoning
3. **Cost histogram** (optional — buckets of 0.5 cents)

## Reproducing

```bash
ANTHROPIC_API_KEY=sk-... \
CF_AI_GATEWAY_URL=https://gateway.ai.cloudflare.com/v1/<acct>/mbfd-bid/anthropic \
  pnpm --filter @mbfd/worker run ai:eval:2025
```

The script reads `analysis/bid_pick.csv` + `analysis/personnel.csv` (committed
under the repo root) and the vendored 2025 rule book, then writes
`docs/ai-eval/2025-replay.md`.
