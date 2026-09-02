/**
 * Admin-only settings router. Mounted at `/api/admin/settings`.
 *
 * Exposes the explicitly configured member bid-page PIN so an admin sitting
 * at the staging bid site can initialize or rotate it without redeploying.
 * The MBFD Hub Filament admin reads/writes the same KV key via the
 * portal-bridge mirror, so both surfaces stay in sync automatically.
 *
 * Routes:
 *   GET  /bid-pin → configured setting or explicit unconfigured state
 *   PUT  /bid-pin { pin: "1234" } → same shape, after a successful write
 */

import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { auditInsertStatement } from '../../lib/audit.js';
import {
  type BidPinReadResult,
  type BidPinSetting,
  getBidPin,
  isValidPin,
  setBidPin,
} from '../../lib/bid-pin.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type SettingsEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const settings = new Hono<SettingsEnv>();
settings.use('*', requireAdmin);

function presentConfiguredSetting(setting: BidPinSetting) {
  return {
    configured: true as const,
    pin: setting.pin,
    updatedAt: setting.updatedAt > 0 ? new Date(setting.updatedAt).toISOString() : null,
    updatedBy: setting.updatedBy,
  };
}

function presentSetting(result: BidPinReadResult) {
  if (result.kind === 'configured') return presentConfiguredSetting(result.setting);
  return { configured: false as const, state: result.kind };
}

settings.get('/bid-pin', async (c) => {
  return c.json(presentSetting(await getBidPin(c.env.KV)));
});

const PutBody = z.object({ pin: z.string() });

settings.put('/bid-pin', async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = PutBody.safeParse(json);
  if (!parsed.success || !isValidPin(parsed.data.pin)) {
    return c.json({ error: 'invalid_pin', detail: 'PIN must be 4–8 digits.' }, 400);
  }
  const claims = c.get('claims');
  const updatedBy = claims.emp ?? `member:${claims.member_id}`;
  // KV and D1 cannot share a transaction. Record the settings mutation before
  // changing the authentication control, and never include the PIN itself in
  // an audit payload.
  await c.env.DB.batch([
    auditInsertStatement(c.env.DB, {
      bidSessionId: null,
      actorType: 'admin',
      actorId: claims.member_id,
      action: 'setting_change',
      targetKind: 'authentication_setting',
      targetId: 'member_bid_pin',
      afterState: { configured: true, updated_by: updatedBy, pin: 'redacted' },
      reason: 'Administrator rotated the member bid access PIN.',
    }),
  ]);
  const setting = await setBidPin(c.env.KV, parsed.data.pin, updatedBy);
  return c.json(presentConfiguredSetting(setting));
});

export default settings;
