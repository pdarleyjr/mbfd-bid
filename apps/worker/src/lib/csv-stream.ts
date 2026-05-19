/**
 * RFC 4180 single-field escape.
 * - Strings are quoted if they contain comma, double-quote, CR, or LF.
 * - Embedded double-quotes are doubled.
 * - null and undefined become empty cells.
 * - Numbers and booleans are stringified directly.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export interface ColumnSpec<T> {
  header: string;
  value: (row: T) => unknown;
}

/**
 * Builds a ReadableStream<Uint8Array> that emits a CSV file: one header
 * row followed by one row per item yielded by the async source. Each row
 * ends with CRLF per RFC 4180.
 *
 * Memory: only the current row's string is held; the source async-iterates
 * one row at a time. Safe for 100k+ row exports on the Worker memory limit.
 */
export function createCsvStream<T>(
  source: AsyncIterable<T>,
  columns: ColumnSpec<T>[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const headerLine = columns.map((c) => escapeCsvField(c.header)).join(',');
      controller.enqueue(encoder.encode(`${headerLine}\r\n`));
      try {
        for await (const row of source) {
          const cells = columns.map((c) => escapeCsvField(c.value(row)));
          controller.enqueue(encoder.encode(`${cells.join(',')}\r\n`));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
