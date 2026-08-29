import { Hono } from 'hono';
import { validateEnv } from '../lib/env.js';
import { verifyJwt } from '../lib/jwt.js';
import { isExpectedPublicWebOrigin } from '../lib/public-web-origin.js';
import { verifiedWebSocketIdentityHeaders } from '../lib/websocket-identity.js';
import { verifyWebSocketTicket } from '../lib/websocket-ticket.js';
import type { WorkerEnv } from '../types/env.js';

const ws = new Hono<{ Bindings: WorkerEnv }>();
const BROWSER_TICKET_PROTOCOL = 'mbfd-bid-v1';
const COMPACT_JWS_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}$/;

function browserTicketFromProtocols(header: string): string | null {
  const protocols = header
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (protocols.length !== 2 || protocols[0] !== BROWSER_TICKET_PROTOCOL) return null;
  const ticket = protocols[1];
  return ticket !== undefined && COMPACT_JWS_PATTERN.test(ticket) ? ticket : null;
}

/**
 * WebSocket upgrade for the live bid session.
 *
 * Browsers cannot set an Authorization header on a WebSocket upgrade. They
 * therefore send a short-lived, session-scoped ticket as a WebSocket
 * subprotocol; the ticket is not a general API JWT and never appears in a
 * URL. Server-side diagnostic clients may still use an Authorization header.
 */
ws.get('/session/:id', async (c) => {
  const env = validateEnv(c.env);

  // CORS middleware does not enforce WebSocket upgrades. Browser clients
  // must therefore present the exact public origin for this environment.
  if (!isExpectedPublicWebOrigin(env, c.req.header('Origin'))) {
    return c.json({ error: 'websocket_origin_forbidden' }, 403);
  }

  if (c.req.header('Upgrade') !== 'websocket') {
    return c.text('Upgrade Required', 426);
  }

  // Query credentials are intentionally retired: browser navigation and
  // intermediary diagnostics can retain URLs long after a JWT expires.
  // Reject them even if an otherwise valid ticket is also supplied.
  if (c.req.query('token') !== undefined) {
    return c.json({ error: 'query_auth_retired' }, 401);
  }

  const id = c.req.param('id');
  let identity: { memberId: number; role: 'member' | 'admin' } | null = null;
  const protocolHeader = c.req.header('Sec-WebSocket-Protocol');
  if (protocolHeader !== undefined) {
    const ticket = browserTicketFromProtocols(protocolHeader);
    if (ticket === null) return c.json({ error: 'invalid_websocket_ticket' }, 401);
    try {
      const claims = await verifyWebSocketTicket(ticket, env.JWT_SIGNING_KEY);
      if (claims.session_id !== id) {
        return c.json({ error: 'websocket_ticket_session_mismatch' }, 401);
      }
      identity = { memberId: claims.sub, role: claims.role };
    } catch {
      return c.json({ error: 'invalid_websocket_ticket' }, 401);
    }
  } else {
    const auth = c.req.header('Authorization');
    if (auth?.startsWith('Bearer ')) {
      try {
        const claims = await verifyJwt(auth.slice(7), env.JWT_SIGNING_KEY);
        identity = { memberId: claims.sub, role: claims.role };
      } catch {
        return c.json({ error: 'invalid_token' }, 401);
      }
    }
  }
  if (identity === null) {
    return c.json({ error: 'missing_auth' }, 401);
  }
  const doId = c.env.BID_SESSION.idFromName(id);
  const stub = c.env.BID_SESSION.get(doId);
  // Forward to DO with verified claims in custom header so the DO does not
  // need to re-validate. The DO trusts only requests via its binding namespace.
  const upstream = await stub.fetch(`${new URL(c.req.url).origin}/ws`, {
    method: 'GET',
    headers: {
      Upgrade: 'websocket',
      ...verifiedWebSocketIdentityHeaders(identity),
    },
  });
  return upstream as unknown as Response;
});

export default ws;
