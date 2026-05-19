import type { WorkerEnv } from '../types/env.js';
import { getSessionCostCents } from './cost-accounting.js';

export type GateResult =
  | { ok: true }
  | { ok: false; reason: 'feature_flag_off' | 'budget_exceeded' };

export async function checkAiGate(env: WorkerEnv, bidSessionId: string): Promise<GateResult> {
  const flag = await env.AI_KV.get(env.AI_FEATURE_FLAG_KEY);
  if (flag === 'false') return { ok: false, reason: 'feature_flag_off' };
  const used = await getSessionCostCents(env.AI_KV, bidSessionId);
  if (used >= env.AI_BUDGET_CAP_CENTS) return { ok: false, reason: 'budget_exceeded' };
  return { ok: true };
}
