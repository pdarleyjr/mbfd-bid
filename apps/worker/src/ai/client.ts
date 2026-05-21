// Workers AI client — replaces the Anthropic SDK + Cloudflare AI Gateway
// pair as of the 2026-05 swap. All inference now runs on the `env.AI`
// binding using Llama 3.3 70B Instruct (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`).
//
// Public surface is unchanged from the previous AnthropicAIClient so callers
// (route handlers, cache-warm, rehearsal proxy-bid) do not churn. The legacy
// class name is re-exported as an alias for one release.

import { ulid } from 'ulid';
import type { WorkerEnv } from '../types/env.js';
import { COST_KEY_PREFIX, addSessionCostCents, getSessionCostCents } from './cost-accounting.js';
import { parseAdvisoryFromText } from './output-parser.js';
import type { Advisory, AdvisoryEnvelope } from './output-schema.js';
import { computeCostCents } from './pricing.js';

export const WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as const;
export const ADVISORY_MODEL_NAME = WORKERS_AI_MODEL;

const LAST_GOOD_PREFIX = 'ai_last_good:';

export interface WorkersAICallInput {
  bidSessionId: string;
  /** Combined system prompt text (rulebook + role instructions). */
  system: string;
  /** Combined user prompt text (roster + current turn state + question). */
  user: string;
  /** Optional precomputed deterministic Advisory used as the absolute-last fallback. */
  deterministicFallback?: { advisory: Advisory };
  /** Per-call timeout. Default: 2500ms (Sonnet-equivalent hot path). */
  timeoutMs?: number;
  /** Override model (test/eval). */
  model?: string;
}

export class AIError extends Error {
  constructor(
    public kind: 'disabled' | 'invalid' | 'upstream',
    message: string,
  ) {
    super(message);
  }
}

interface WorkersAiRunResult {
  response?: string;
  // Older / typed shapes return tool_calls or usage; we don't read them yet.
  [k: string]: unknown;
}

// Minimal structural type for `env.AI.run`. We rely on the runtime Workers AI
// binding (Llama 3.3 70B Instruct) — older `@cloudflare/workers-types` versions
// (e.g. 4.20241011 used by the web app's pinned dep) have overload sets that
// require model-literal keys, which clashes with our string model id. We
// narrow to a permissive structural type so the worker compiles against any
// version of the types that includes `env.AI.run`.
interface AiBindingLike {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | ReadableStream<Uint8Array>>;
}

export class WorkersAIClient {
  constructor(private readonly env: WorkerEnv) {}

  private get aiRun(): AiBindingLike {
    return this.env.AI as unknown as AiBindingLike;
  }

  /** SHA-256 hex of the concatenated prompt parts (audit trail). */
  async hashPrompt(...parts: string[]): Promise<string> {
    const buf = new TextEncoder().encode(parts.join('\x1f'));
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  private async featureEnabled(): Promise<boolean> {
    const v = await this.env.AI_KV.get(this.env.AI_FEATURE_FLAG_KEY);
    return v !== 'false';
  }

  private async budgetRemaining(bidSessionId: string): Promise<number> {
    const used = await getSessionCostCents(this.env.AI_KV, bidSessionId);
    return this.env.AI_BUDGET_CAP_CENTS - used;
  }

  private async lastGood(bidSessionId: string): Promise<AdvisoryEnvelope | null> {
    const raw = await this.env.AI_KV.get(LAST_GOOD_PREFIX + bidSessionId);
    if (!raw) return null;
    try {
      const obj = JSON.parse(raw) as {
        advisory: Advisory;
        generated_at_ms?: number;
        ai_advisory_id?: string | null;
      };
      return {
        advisory: obj.advisory,
        stale: true,
        fallback: 'last_good',
        generated_at_ms: obj.generated_at_ms ?? 0,
        ai_advisory_id: obj.ai_advisory_id ?? null,
      };
    } catch {
      return null;
    }
  }

  private async writeLastGood(bidSessionId: string, envelope: AdvisoryEnvelope): Promise<void> {
    await this.env.AI_KV.put(
      LAST_GOOD_PREFIX + bidSessionId,
      JSON.stringify({
        advisory: envelope.advisory,
        generated_at_ms: envelope.generated_at_ms,
        ai_advisory_id: envelope.ai_advisory_id,
      }),
      { expirationTtl: 60 * 60 * 24 * 7 },
    );
  }

  async adviseCurrent(input: WorkersAICallInput): Promise<AdvisoryEnvelope> {
    return this.callNonStreaming({
      ...input,
      model: input.model ?? WORKERS_AI_MODEL,
      timeoutMs: input.timeoutMs ?? 15000,
    });
  }

  /** Async pre-fetch helper used by cache-warm. Same as adviseCurrent but the
   * caller awaits nothing — it writes last-good silently. */
  async preFetch(input: WorkersAICallInput): Promise<void> {
    await this.callNonStreaming({
      ...input,
      model: input.model ?? WORKERS_AI_MODEL,
      timeoutMs: input.timeoutMs ?? 20000,
    });
  }

  /**
   * Deep-streaming call. Returns the raw `ReadableStream` produced by
   * `env.AI.run(... { stream: true })` so the route handler can pipe it
   * directly to the client as SSE. The Workers AI binding emits OpenAI-style
   * SSE chunks (`data: {"response":"..."}\n\n`) which the route handler
   * forwards verbatim.
   */
  async adviseDeepStream(input: WorkersAICallInput): Promise<ReadableStream<Uint8Array>> {
    if (!(await this.featureEnabled())) {
      throw new AIError('disabled', 'feature_flag_off');
    }
    if ((await this.budgetRemaining(input.bidSessionId)) <= 0) {
      throw new AIError('disabled', 'budget_exceeded');
    }
    const messages = [
      { role: 'system' as const, content: input.system },
      { role: 'user' as const, content: input.user },
    ];
    const gatewayId = extractGatewayId(this.env.CF_AI_GATEWAY_URL);
    const options = gatewayId ? { gateway: { id: gatewayId } } : undefined;
    const result = await this.aiRun.run(
      input.model ?? WORKERS_AI_MODEL,
      {
        messages,
        stream: true,
        max_tokens: 2048,
      },
      options,
    );
    // The `stream: true` overload returns a ReadableStream of SSE chunks.
    return result as unknown as ReadableStream<Uint8Array>;
  }

  // ---- private ----

  private async callNonStreaming(
    input: WorkersAICallInput & { model: string; timeoutMs: number },
  ): Promise<AdvisoryEnvelope> {
    if (!(await this.featureEnabled())) {
      return this.fallback(input);
    }
    if ((await this.budgetRemaining(input.bidSessionId)) <= 0) {
      return this.fallback(input);
    }

    const messages = [
      { role: 'system' as const, content: input.system },
      { role: 'user' as const, content: input.user },
    ];

    // The Workers AI binding does not currently honor AbortSignal, so we
    // implement a timeout via Promise.race rather than ac.abort().
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new AIError('upstream', 'timeout')), input.timeoutMs);
    });

    const gatewayId = extractGatewayId(this.env.CF_AI_GATEWAY_URL);
    const options = gatewayId ? { gateway: { id: gatewayId } } : undefined;

    let res: WorkersAiRunResult;
    try {
      res = (await Promise.race([
        this.aiRun.run(
          input.model,
          {
            messages,
            max_tokens: 1500,
            response_format: { type: 'json_object' },
          },
          options,
        ),
        timeout,
      ])) as WorkersAiRunResult;
    } catch {
      return this.fallback(input);
    }

    // Llama returns the response text in the `response` field. Defensive: tools
    // sometimes return `{ result: { response: "..." } }` or a raw string.
    const text = extractResponseText(res);
    const advisory = parseAdvisoryFromText(text);
    if (!advisory) return this.fallback(input);

    // Workers AI is currently free within the Workers Paid plan's neuron
    // quota; pricing.ts returns 0 cents for the Llama model. We still
    // exercise the cost-accounting code path so the per-session key exists
    // and the rehearsal dashboard has a row to render.
    const cost = computeCostCents(input.model, {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    await addSessionCostCents(this.env.AI_KV, input.bidSessionId, cost);

    const envelope: AdvisoryEnvelope = {
      advisory,
      stale: false,
      fallback: 'none',
      generated_at_ms: Date.now(),
      ai_advisory_id: ulid(),
    };
    await this.writeLastGood(input.bidSessionId, envelope);

    return envelope;
  }

  private async fallback(input: WorkersAICallInput): Promise<AdvisoryEnvelope> {
    const lg = await this.lastGood(input.bidSessionId);
    if (lg) return lg;
    if (input.deterministicFallback) {
      return {
        advisory: input.deterministicFallback.advisory,
        stale: true,
        fallback: 'deterministic',
        generated_at_ms: Date.now(),
        ai_advisory_id: null,
      };
    }
    // Absolute degenerate fallback — empty advisory but valid shape.
    return {
      advisory: {
        summary: 'AI advisor unavailable. Falling back to deterministic eligibility only.',
        eligible_recommendations: [],
        ineligible_top_picks: [],
        forecast: { warnings: [] },
        force_recommended: false,
      },
      stale: true,
      fallback: 'deterministic',
      generated_at_ms: Date.now(),
      ai_advisory_id: null,
    };
  }
}

function extractGatewayId(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parts = new URL(url).pathname.split('/');
    if (parts[1] === 'v1' && parts[3]) {
      return parts[3];
    }
  } catch {}
  return undefined;
}

function extractResponseText(res: WorkersAiRunResult | string | undefined): string {
  if (res === undefined || res === null) return '';
  if (typeof res === 'string') return res;
  if (typeof res.response === 'string') return res.response;
  const nested = res.result;
  if (nested && typeof nested === 'object' && 'response' in (nested as Record<string, unknown>)) {
    const r = (nested as { response?: unknown }).response;
    if (typeof r === 'string') return r;
  }
  return '';
}

// ── Back-compat re-exports ──────────────────────────────────────────────────
// The earlier Plan 06 implementation used `AnthropicAIClient`. The Workers AI
// swap renames it to `WorkersAIClient`. We re-export the old name as an alias
// so test files and any external callers (in this branch only — there are no
// known external consumers) continue to compile. This alias may be removed
// once all references are renamed.
export const AnthropicAIClient = WorkersAIClient;
export type AnthropicAIClient = WorkersAIClient;

export { COST_KEY_PREFIX };
