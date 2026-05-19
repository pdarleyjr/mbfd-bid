/**
 * America/New_York (Eastern Time) helpers.
 *
 * Storage convention: UTC always (ms timestamp or ISO Z string).
 * Display + input convention: ET wall time.
 *
 * No external dependencies — we use Intl.DateTimeFormat and a small
 * computation to derive the ET offset at any given instant.
 */

const ET = 'America/New_York';

/**
 * Returns the ET offset (in minutes, e.g. -300 for EST, -240 for EDT) for
 * the given UTC instant. Computed by formatting the instant in ET and
 * comparing to UTC.
 */
function etOffsetMinutes(utc: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = fmt.formatToParts(utc).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  // Intl can return 24 for hour:'2-digit' at midnight; normalize.
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  const etAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((etAsUtc - utc.getTime()) / 60000);
}

export function formatET(date: Date, mode: 'time' | 'date' | 'datetime'): string {
  const options: Intl.DateTimeFormatOptions =
    mode === 'time'
      ? { timeZone: ET, hour: '2-digit', minute: '2-digit', hour12: true }
      : mode === 'date'
        ? { timeZone: ET, year: 'numeric', month: 'short', day: '2-digit' }
        : {
            timeZone: ET,
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          };
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

/**
 * Parses a `<input type="datetime-local">` value (which has NO timezone,
 * e.g. "2026-11-15T09:00") as ET wall time and returns the corresponding
 * UTC Date.
 */
export function parseEtLocalInput(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (m === null) throw new Error(`invalid datetime-local: ${value}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6] ?? '0');
  // Build a UTC instant pretending the input was UTC, then offset by ET's
  // offset at that approximate instant to get the real UTC equivalent.
  const naive = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const offsetMin = etOffsetMinutes(naive);
  return new Date(naive.getTime() - offsetMin * 60000);
}

/** Returns the date as ISO with an explicit ET offset suffix. */
export function toEtIso(utc: Date): string {
  const off = etOffsetMinutes(utc);
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${new Date(utc.getTime() + off * 60000).toISOString().slice(0, 19)}${sign}${hh}:${mm}`;
}
