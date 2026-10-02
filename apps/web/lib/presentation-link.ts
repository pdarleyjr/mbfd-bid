/** An explicit audience link always follows the session the operator opened. */
export function presentationHref(sessionId?: string): string {
  return sessionId === undefined ? '/live' : `/live?bidSessionId=${encodeURIComponent(sessionId)}`;
}

export function presentationApiPath(sessionId?: string): string {
  return sessionId === undefined
    ? '/api/presentation'
    : `/api/presentation?bidSessionId=${encodeURIComponent(sessionId)}`;
}
