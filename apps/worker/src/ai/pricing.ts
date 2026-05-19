// Source of truth for per-model pricing. Bump in a 1-line PR when Anthropic
// updates rates. Prices below are in CENTS per MILLION input/output tokens
// (USD pricing converted; cache-read is 10% of input, cache-write is 1.25×
// input, per Anthropic prompt-caching docs as of 2026-05).

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
  // Sonnet 4.6: $3 / MTok input, $15 / MTok output → cents
  'claude-sonnet-4-6': pricing(300, 1500),
  // Opus 4.7: $15 / MTok input, $75 / MTok output → cents
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
