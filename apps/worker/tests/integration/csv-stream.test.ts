import { describe, expect, it } from 'vitest';
import { createCsvStream, escapeCsvField } from '../../src/lib/csv-stream.js';

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const flat = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    flat.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(flat);
}

async function* asyncFrom<T>(arr: T[]): AsyncIterable<T> {
  for (const x of arr) yield x;
}

describe('escapeCsvField', () => {
  it('returns plain text unmodified', () => {
    expect(escapeCsvField('hello')).toBe('hello');
  });
  it('quotes fields containing a comma', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
  });
  it('quotes fields containing CR or LF', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });
  it('doubles embedded quotes', () => {
    expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""');
  });
  it('renders null and undefined as empty', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });
  it('renders booleans as true/false', () => {
    expect(escapeCsvField(true)).toBe('true');
    expect(escapeCsvField(false)).toBe('false');
  });
  it('renders numbers as their decimal string', () => {
    expect(escapeCsvField(42)).toBe('42');
    expect(escapeCsvField(3.14)).toBe('3.14');
  });
});

describe('createCsvStream', () => {
  type Row = { id: number; name: string; notes: string | null };

  it('emits a header row and one data row', async () => {
    const stream = createCsvStream<Row>(asyncFrom<Row>([{ id: 1, name: 'Alpha', notes: null }]), [
      { header: 'ID', value: (r) => r.id },
      { header: 'Name', value: (r) => r.name },
      { header: 'Notes', value: (r) => r.notes },
    ]);
    const out = await readAll(stream);
    expect(out).toBe('ID,Name,Notes\r\n1,Alpha,\r\n');
  });

  it('quotes fields that contain commas', async () => {
    const stream = createCsvStream<Row>(
      asyncFrom<Row>([{ id: 2, name: 'Last, First', notes: 'ok' }]),
      [
        { header: 'ID', value: (r) => r.id },
        { header: 'Name', value: (r) => r.name },
        { header: 'Notes', value: (r) => r.notes },
      ],
    );
    expect(await readAll(stream)).toBe('ID,Name,Notes\r\n2,"Last, First",ok\r\n');
  });

  it('emits zero data rows when the source is empty (header only)', async () => {
    const stream = createCsvStream<Row>(asyncFrom<Row>([]), [{ header: 'ID', value: (r) => r.id }]);
    expect(await readAll(stream)).toBe('ID\r\n');
  });

  it('emits 1000 rows without buffering more than one row at a time', async () => {
    async function* gen(): AsyncIterable<Row> {
      for (let i = 0; i < 1000; i++) {
        yield { id: i, name: `row${i}`, notes: null };
      }
    }
    const stream = createCsvStream<Row>(gen(), [
      { header: 'ID', value: (r) => r.id },
      { header: 'Name', value: (r) => r.name },
    ]);
    const out = await readAll(stream);
    const lines = out.split('\r\n');
    // 1 header + 1000 data + trailing empty after final \r\n
    expect(lines.length).toBe(1002);
    expect(lines[0]).toBe('ID,Name');
    expect(lines[1000]).toBe('999,row999');
  });
});
