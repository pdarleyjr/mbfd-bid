import { type Advisory, AdvisorySchema } from './output-schema.js';

const FENCE = /```(?:json)?\s*([\s\S]*?)```/m;

/**
 * Best-effort extraction of an Advisory JSON object from Claude's raw text
 * response. Returns null when no valid JSON of the required shape can be
 * extracted. Caller chooses the fallback strategy (deterministic / last-good).
 */
export function parseAdvisoryFromText(text: string): Advisory | null {
  if (!text) return null;
  // Strip BOM and surrounding whitespace
  const trimmed = text.replace(/^﻿/, '').trim();

  // 1) Try fenced block first (most common Claude output for JSON mode)
  const fenced = trimmed.match(FENCE);
  const candidate = fenced?.[1] ? fenced[1].trim() : trimmed;

  // 2) Find the first '{' and matching '}' span; if the candidate is just
  //    JSON this is a no-op, otherwise it salvages the JSON from a
  //    prefix-then-prose response.
  const start = candidate.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;

  const slice = candidate.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return null;
  }
  const v = AdvisorySchema.safeParse(parsed);
  return v.success ? v.data : null;
}
