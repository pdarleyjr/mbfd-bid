import type { WorkerEnv } from '../types/env.js';

/**
 * Portal publication is deliberately opt-in. In particular, a staging Worker
 * may still use PORTAL_BASE_URL for read-only authentication without gaining
 * permission to send an award to that portal.
 */
export type PortalPublicationPolicy =
  | {
      enabled: true;
      portalBaseUrl: string;
      writerToken: string;
    }
  | {
      enabled: false;
      reason:
        | 'publication_not_explicitly_enabled'
        | 'writer_credential_missing'
        | 'writeback_endpoint_missing_or_invalid';
      portalBaseUrl: string | null;
      writerToken: string | null;
    };

function isSecureWritebackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username.length === 0 && url.password.length === 0;
  } catch {
    return false;
  }
}

/**
 * Resolve the only configuration that can permit an outbound portal write.
 * Every missing, malformed, or non-literal value fails closed.
 */
export function resolvePortalPublicationPolicy(
  env: Pick<
    WorkerEnv,
    'PORTAL_WRITEBACK_ENABLED' | 'PORTAL_WRITEBACK_BASE_URL' | 'PORTAL_BID_WRITER'
  >,
): PortalPublicationPolicy {
  if (env.PORTAL_WRITEBACK_ENABLED !== 'true') {
    return {
      enabled: false,
      reason: 'publication_not_explicitly_enabled',
      portalBaseUrl: null,
      writerToken: null,
    };
  }

  const writerToken = env.PORTAL_BID_WRITER?.trim() ?? '';
  if (writerToken.length === 0) {
    return {
      enabled: false,
      reason: 'writer_credential_missing',
      portalBaseUrl: null,
      writerToken: null,
    };
  }

  const portalBaseUrl = env.PORTAL_WRITEBACK_BASE_URL?.trim() ?? '';
  if (!isSecureWritebackUrl(portalBaseUrl)) {
    return {
      enabled: false,
      reason: 'writeback_endpoint_missing_or_invalid',
      portalBaseUrl: null,
      writerToken: null,
    };
  }

  return {
    enabled: true,
    portalBaseUrl,
    writerToken,
  };
}

export function isPortalPublicationEnabled(
  env: Pick<
    WorkerEnv,
    'PORTAL_WRITEBACK_ENABLED' | 'PORTAL_WRITEBACK_BASE_URL' | 'PORTAL_BID_WRITER'
  >,
): boolean {
  return resolvePortalPublicationPolicy(env).enabled;
}
