import { type LoginResponse, LoginResponseSchema, RANK_LABELS, type Rank } from '@mbfd/shared';
import { z } from 'zod';

const PORTAL_RANK_CODE_BY_LABEL = new Map<string, Rank>(
  Object.entries(RANK_LABELS).map(([rank, label]) => [label, rank as Rank]),
);

/**
 * The Employee Portal sends human-readable rank labels while the Bid contract
 * intentionally stores canonical rank codes. Translate only known labels;
 * unknown values remain untouched so LoginResponseSchema fails closed.
 */
function normalizePortalLoginResponse(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return payload;

  const record = payload as Record<string, unknown>;
  if (typeof record.rank !== 'string') return payload;

  const canonicalRank = PORTAL_RANK_CODE_BY_LABEL.get(record.rank.trim());
  return canonicalRank ? { ...record, rank: canonicalRank } : payload;
}

export interface VerifyCredentialsInput {
  portalBaseUrl: string;
  token: string;
  employee_id: string;
  password: string;
}

export async function verifyCredentials(
  input: VerifyCredentialsInput,
): Promise<LoginResponse | null> {
  const url = `${input.portalBaseUrl}/api/v2/verify-credentials`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.token}`,
      'User-Agent': 'mbfd-bid-worker/1.0',
    },
    body: JSON.stringify({
      employee_id: input.employee_id,
      password: input.password,
    }),
  });

  if (res.status === 401) return null;
  if (res.status >= 500) throw new Error('portal_unavailable');
  if (!res.ok) throw new Error(`portal_error_${res.status}`);

  const json = (await res.json()) as unknown;
  return LoginResponseSchema.parse(normalizePortalLoginResponse(json));
}

const FederationResponseSchema = z
  .object({
    issuer: z.string().url(),
    audience: z.literal('bid'),
  })
  .passthrough();

export interface ExchangeAuthorizationCodeInput {
  portalBaseUrl: string;
  token: string;
  code: string;
  redirect_uri: string;
}

export async function exchangeAuthorizationCode(
  input: ExchangeAuthorizationCodeInput,
): Promise<LoginResponse | null> {
  const portalOrigin = new URL(input.portalBaseUrl).origin;
  const url = `${input.portalBaseUrl.replace(/\/$/, '')}/api/v2/bid/auth/exchange`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.token}`,
      'User-Agent': 'mbfd-bid-worker/1.0',
    },
    body: JSON.stringify({
      code: input.code,
      client_id: 'bid',
      redirect_uri: input.redirect_uri,
    }),
  });

  if (res.status === 401 || res.status === 403) return null;
  if (res.status >= 500) throw new Error('portal_unavailable');
  if (!res.ok) throw new Error(`portal_error_${res.status}`);

  const json = (await res.json()) as unknown;
  const federation = FederationResponseSchema.parse(json);
  if (federation.issuer !== portalOrigin) throw new Error('portal_issuer_mismatch');

  return LoginResponseSchema.parse(normalizePortalLoginResponse(json));
}
