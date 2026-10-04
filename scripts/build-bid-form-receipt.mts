/** Build a private, schema-normalized R2 source receipt without network or DB writes.
 * Usage: pnpm --filter @mbfd/worker exec tsx ../../scripts/build-bid-form-receipt.mts
 * --source <private-packet.json> --actor-member-id <verified-id> --output <private-receipt.json>
 */
import { readFile, writeFile } from 'node:fs/promises';
import {
  BidFormArchiveSchema,
  BidFormReceiptSchema,
  bidFormArchiveHasIdentityConflict,
  bidFormArchiveHash,
} from '../apps/worker/src/lib/bid-form-source.js';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (
    !key ||
    !value ||
    !['--source', '--actor-member-id', '--output'].includes(key) ||
    args.has(key)
  ) {
    throw new Error('Supply exactly --source, --actor-member-id and --output.');
  }
  args.set(key, value);
}
const source = args.get('--source');
const actor = args.get('--actor-member-id');
const output = args.get('--output');
if (
  !source ||
  !output ||
  !actor ||
  !/^[1-9]\d*$/.test(actor) ||
  !Number.isSafeInteger(Number(actor))
)
  throw new Error(
    'A verified, positive operator member ID and private input/output paths are required.',
  );
const parsed = BidFormArchiveSchema.safeParse(JSON.parse(await readFile(source, 'utf8')));
if (!parsed.success) {
  // Never include raw submission, contact, source values or unknown field names.
  throw new Error(`Invalid source packet: ${parsed.error.issues.length} schema issue(s).`);
}
const archive = parsed.data;
if (bidFormArchiveHasIdentityConflict(archive))
  throw new Error('Source packet has conflicting resolved identities.');
const sha256 = await bidFormArchiveHash(archive);
const receipt = BidFormReceiptSchema.parse({
  archive,
  sha256,
  publishedAt: new Date().toISOString(),
  publishedBy: actor,
});
await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(
  `${JSON.stringify({
    archiveSha256: sha256,
    currentKey: `bid-forms/v1/${archive.year}.json`,
    immutableKey: `bid-forms/v1/revisions/${archive.year}/${sha256}.json`,
    submittedForms: archive.forms.length,
    notSubmitted: archive.notSubmitted.length,
    airTechReferences: archive.airTechReferences?.length ?? 0,
    publicationPerformed: false,
  })}\n`,
);
