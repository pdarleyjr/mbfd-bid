/**
 * Hono's stock logger includes the request URL. Query strings may contain
 * short-lived credentials, so preserve only the route path in Worker logs.
 */
export function redactRequestLog(message: string): string {
  return message.replace(/\?\S*/g, '?<redacted>');
}
