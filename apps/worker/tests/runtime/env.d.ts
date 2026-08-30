import type { BidSessionDO } from '../../src/durable/bid-session.js';

declare global {
  namespace Cloudflare {
    interface Env {
      BID_SESSION: DurableObjectNamespace<BidSessionDO>;
      DB: D1Database;
      JWT_SIGNING_KEY: string;
      TEST_MIGRATIONS: Parameters<typeof import('cloudflare:test').applyD1Migrations>[1];
    }

    interface GlobalProps {
      mainModule: typeof import('../../src/index.js');
    }
  }
}
