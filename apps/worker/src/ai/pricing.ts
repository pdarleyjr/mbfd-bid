// Source of truth for per-model pricing.
//
// Workers AI swap (2026-05): the worker now runs Llama 3.3 70B Instruct on
// Cloudflare's `env.AI` binding. Workers AI bills in "neurons" (10k free per
// day on the $5 Workers Paid plan); within typical bid-event volume we stay
// inside the free quota. Per F-035 the /cost endpoint still returns numeric
// cents (cap and used), so we represent the active model with a 0-cost
// entry and keep the legacy Anthropic price points around for historical
// audit-log replay (`replay-2025.ts`).

export interface ModelPricing {
  /** Cents per 1M input tokens (non-cached). */
  inputCentsPerMTok: number;
  /** Cents per 1M output tokens. */
  outputCentsPerMTok: number;
  /** Cents per 1M input tokens served from cache (=inputCentsPerMTok × 0.1). */
  cacheReadCentsPerMTok: number;
  /** Cents per 1M input tokens written to cache (=inputCentsPerMTok × 1.25). */
  cacheWriteCentsPerMTok: number;
}

function pricing(input: number, output: number): ModelPricing {
  return {
    inputCentsPerMTok: input,
    outputCentsPerMTok: output,
    cacheReadCentsPerMTok: input * 0.1,
    cacheWriteCentsPerMTok: input * 1.25,
  };
}

export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  // Workers AI — Llama 3.3 70B Instruct. Free within the $5 plan's neuron
  // quota for the bid-event workload; we record 0 cents per call and let
  // the rehearsal dashboard / cost endpoint report a 0 running total.
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': pricing(0, 0),
  // Legacy Anthropic price points — retained so `replay-2025.ts` and any
  // historic `ai_advisories.model` values can still be cost-checked offline.
  'claude-sonnet-4-6': pricing(300, 1500),
  'claude-opus-4-7': pricing(1500, 7500),
};

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function computeCostCents(modelId: string, u: TokenUsage): number {
  const p = MODEL_PRICING[modelId];
  if (!p) return 0;
  const cents =
    (u.input * p.inputCentsPerMTok +
      u.cacheRead * p.cacheReadCentsPerMTok +
      u.cacheWrite * p.cacheWriteCentsPerMTok +
      u.output * p.outputCentsPerMTok) /
    1_000_000;
  return Math.round(cents);
}
