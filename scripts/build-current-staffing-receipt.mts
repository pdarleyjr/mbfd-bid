/** Prepare a contact-free private source receipt. No network or DB writes.
 * pnpm --filter @mbfd/worker exec tsx ../../scripts/build-current-staffing-receipt.mts
 * --source <directory.csv> --actor-member-id <verified-id> --snapshot-at <ISO instant> --output <private-receipt.json>
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  CURRENT_STAFFING_KEY,
  CurrentStaffingReceiptSchema,
  currentStaffingArchiveFromCsv,
  currentStaffingArchiveHash,
} from '../apps/worker/src/lib/current-staffing-source.js';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (
    !key ||
    !value ||
    !['--source', '--actor-member-id', '--snapshot-at', '--output'].includes(key) ||
    args.has(key)
  )
    throw new Error('Supply exactly --source, --actor-member-id, --snapshot-at and --output.');
  args.set(key, value);
}
const source = args.get('--source');
const actor = args.get('--actor-member-id');
const output = args.get('--output');
const snapshotAt = args.get('--snapshot-at');
if (
  !source ||
  !output ||
  !snapshotAt ||
  !actor ||
  !/^[1-9]\d*$/.test(actor) ||
  !Number.isSafeInteger(Number(actor))
)
  throw new Error(
    'Verified operator ID and private source/output paths and snapshot instant are required.',
  );
const bytes = await readFile(source);
const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
const archive = await currentStaffingArchiveFromCsv(
  bytes.toString('utf8'),
  basename(source),
  sourceSha256,
  snapshotAt,
);
const sha256 = await currentStaffingArchiveHash(archive);
const receipt = CurrentStaffingReceiptSchema.parse({
  archive,
  sha256,
  publishedAt: new Date().toISOString(),
  publishedBy: actor,
});
await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(
  `${JSON.stringify({
    rows: archive.rows.length,
    sourceSha256,
    archiveSha256: sha256,
    currentKey: CURRENT_STAFFING_KEY,
    immutableKey: `current-staffing/v1/revisions/${sha256}.json`,
    shiftCounts: Object.fromEntries(
      ['A', 'B', 'C', 'D'].map((shift) => [
        shift,
        archive.rows.filter((row) => row.shift === shift).length,
      ]),
    ),
    publicationPerformed: false,
  })}\n`,
);
