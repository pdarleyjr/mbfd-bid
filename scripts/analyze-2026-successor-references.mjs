import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildCorrected2026Topology } from '../apps/worker/src/lib/corrected-2026-topology.ts';

const path = process.argv[2];
if (!path) throw new Error('Provide a private immutable Bid version content path');
const bytes = await readFile(path);
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (sha256 !== '74ee775dbae3508c16f82bb93e4e2a68a5b3f84a976f05be85c89a0800e3f666')
  throw new Error('bid_version_8_content_hash_mismatch');
const content = JSON.parse(bytes.toString('utf8'));
const oldIds = new Set(content.positions.map((position) => position.id));
const correctedIds = new Set(buildCorrected2026Topology().map((position) => position.id));
const groups = new Map();
function visit(value, pathSegments = []) {
  if (typeof value === 'string') {
    if (!oldIds.has(value)) return;
    const key = pathSegments.map((part) => (typeof part === 'number' ? '[]' : part)).join('.');
    const item = groups.get(key) ?? { count: 0, retired: 0, examples: [] };
    item.count += 1;
    if (!correctedIds.has(value)) item.retired += 1;
    if (item.examples.length < 5 && !item.examples.includes(value)) item.examples.push(value);
    groups.set(key, item);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, [...pathSegments, index]));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) visit(item, [...pathSegments, key]);
  }
}
visit(content);
process.stdout.write(
  JSON.stringify(
    {
      immutableSourceSha256: sha256,
      oldPositionCount: oldIds.size,
      correctedPositionCount: correctedIds.size,
      referenceGroups: Object.fromEntries(
        [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
    null,
    2,
  ),
);
process.stdout.write('\n');
