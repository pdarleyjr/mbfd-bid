// Plan 08 Task 3 — RFC 8785 (JCS) canonical JSON serializer.
//
// Byte-stable serialization is the foundation of the audit hash chain — every
// implementation that re-hashes a chunk MUST produce the same bytes for the
// same logical input. We restrict the algorithm to the subset our audit
// events actually use: integers, booleans, null, strings, arrays, and plain
// objects. Floats and special numeric values (NaN / Infinity) are rejected
// up front so a programming mistake fails loudly instead of silently
// producing un-verifiable bytes.

export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | JsonValue[] | { [k: string]: JsonValue };

/**
 * Serialize a JSON value following RFC 8785 (JCS): object keys are sorted
 * lexicographically, no whitespace is emitted, arrays preserve order, and
 * strings are escaped with the minimum required by JSON.
 *
 * Throws if the input contains a NaN, Infinity, non-integer number, or
 * undefined value — none of which are representable in the audit format.
 */
export function canonicalize(v: JsonValue): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (Number.isNaN(v)) throw new Error('NaN not representable in canonical JSON');
    if (!Number.isFinite(v)) throw new Error('Infinity not representable in canonical JSON');
    if (!Number.isInteger(v)) throw new Error('Non-integer numbers not supported');
    return String(v);
  }
  if (typeof v === 'string') return canonicalString(v);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(',')}]`;
  if (typeof v === 'object') {
    const obj = v as { [k: string]: JsonValue };
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const val = obj[k];
      if (val === undefined) throw new Error(`undefined value at "${k}"`);
      parts.push(`${canonicalString(k)}:${canonicalize(val)}`);
    }
    return `{${parts.join(',')}}`;
  }
  throw new Error(`Unsupported value: ${typeof v}`);
}

function canonicalString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += '\\\\';
    else if (c === 0x08) out += '\\b';
    else if (c === 0x09) out += '\\t';
    else if (c === 0x0a) out += '\\n';
    else if (c === 0x0c) out += '\\f';
    else if (c === 0x0d) out += '\\r';
    else if (c < 0x20) out += `\\u${c.toString(16).padStart(4, '0')}`;
    else out += s[i];
  }
  return `${out}"`;
}
