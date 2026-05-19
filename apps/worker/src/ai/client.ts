import Anthropic from '@anthropic-ai/sdk';
import { ulid } from 'ulid';
import type { WorkerEnv } from '../types/env.js';
import { COST_KEY_PREFIX, addSessionCostCents, getSessionCostCents } from './cost-accounting.js';
import { parseAdvisoryFromText } from './output-parser.js';
import type { Advisory, AdvisoryEnvelope } from './output-schema.js';
import { computeCostCents } from './pricing.js';

export interface SonnetCallInput {
  bidSessionId: string;
  /** Cached system block — array shape with cache_control. */
  system: NonNullable<Anthropic.MessageCreateParams['system']>;
  /** Cached user roster block — first user message. */
  roster: Array<{ type: 'text'; text: string; cache_control: { type: 'ephemeral' } }>;
  /** Uncached turn block — second user message. */
  turn: Array<{ type: 'text'; text: string }>;
  /** Optional precomputed deterministic Advisory used as the absolute-last fallback. */
  deterministicFallback?: { advisory: Advisory };
  /** Per-call timeout. Default: 2500ms (Sonnet hot path). */
  timeoutMs?: number;
  /** Override model (test/eval). */
  model?: string;
}

const SONNET = 'claude-sonnet-4-6';
const OPUS = 'claude-opus-4-7';
const LAST_GOOD_PREFIX = 'ai_last_good:';

export class AIError extends Error {
  constructor(
    public kind: 'disabled' | 'invalid' | 'upstream',
    message: string,
  ) {
    super(message);
  }
}

export class AnthropicAIClient {
  private readonly client: Anthropic;

  constructor(private readonly env: WorkerEnv) {
    this.client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      baseURL: env.CF_AI_GATEWAY_URL,
      // Anthropic SDK uses fetch by default; CF Workers polyfill works.
    });
  }

  /** SHA-256 hex of the concatenated system/roster/turn texts (audit trail). */
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

  async adviseCurrent(input: SonnetCallInput): Promise<AdvisoryEnvelope> {
    return this.callNonStreaming({
      ...input,
      model: input.model ?? SONNET,
      timeoutMs: input.timeoutMs ?? 2500,
    });
  }

  /** Async pre-fetch helper used by cache-warm. Same as adviseCurrent but the
   * caller awaits nothing — it writes last-good silently. */
  async preFetch(input: SonnetCallInput): Promise<void> {
    await this.callNonStreaming({
      ...input,
      model: input.model ?? SONNET,
      timeoutMs: input.timeoutMs ?? 4000,
    });
  }

  /** Opus streaming call returning the underlying SDK stream so the route can
   * tee it as SSE. The caller is responsible for closing the stream. */
  async adviseDeepStream(input: SonnetCallInput) {
    if (!(await this.featureEnabled())) {
      throw new AIError('disabled', 'feature_flag_off');
    }
    if ((await this.budgetRemaining(input.bidSessionId)) <= 0) {
      throw new AIError('disabled', 'budget_exceeded');
    }
    return this.client.messages.stream({
      model: input.model ?? OPUS,
      max_tokens: 2048,
      system: input.system,
      messages: [
        {
          role: 'user',
          content: [...input.roster, ...input.turn] as Anthropic.ContentBlockParam[],
        },
      ],
    } as Anthropic.MessageStreamParams);
  }

  // ---- private ----

  private async callNonStreaming(
    input: SonnetCallInput & { model: string; timeoutMs: number },
  ): Promise<AdvisoryEnvelope> {
    if (!(await this.featureEnabled())) {
      return this.fallback(input);
    }
    if ((await this.budgetRemaining(input.bidSessionId)) <= 0) {
      return this.fallback(input);
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), input.timeoutMs);

    let res: Anthropic.Messages.Message;
    try {
      res = await this.client.messages.create(
        {
          model: input.model,
          max_tokens: 1500,
          system: input.system,
          messages: [
            {
              role: 'user',
              content: [...input.roster, ...input.turn] as Anthropic.ContentBlockParam[],
            },
          ],
        },
        { signal: ac.signal },
      );
    } catch {
      return this.fallback(input);
    } finally {
      clearTimeout(timer);
    }

    // Anthropic returns content array; advisory is in the first text block.
    const text = res.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    const advisory = parseAdvisoryFromText(text);
    if (!advisory) return this.fallback(input);

    // Cost + KV.
    const usage = res.usage;
    const cost = computeCostCents(res.model, {
      input: usage.input_tokens,
      output: usage.output_tokens,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
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

  private async fallback(input: SonnetCallInput): Promise<AdvisoryEnvelope> {
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

export { COST_KEY_PREFIX };
