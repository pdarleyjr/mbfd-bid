import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../.github/workflows/deploy-staging.yml', import.meta.url),
  'utf8',
);
const guard = readFileSync(
  new URL('./assert-staging-d1-migration-guard.mjs', import.meta.url),
  'utf8',
);

assert.doesNotMatch(
  workflow,
  /\bwrangler\s+d1\s+migrations\s+apply\b/i,
  'ordinary staging deployment must never apply D1 migrations',
);
assert.match(
  workflow,
  /node\s+scripts\/assert-staging-d1-migration-guard\.mjs/i,
  'ordinary staging deployment must invoke the fail-closed migration guard',
);
assert.doesNotMatch(
  guard,
  /\bd1\s+migrations\s+apply\b/i,
  'the guard itself must remain read-only',
);
assert.match(
  guard,
  /SELECT name FROM d1_migrations ORDER BY id ASC/i,
  'the guard must compare the managed D1 ledger with canonical migrations',
);

process.stdout.write(
  'PASS: ordinary staging deployment is guarded against batch D1 migration apply.\n',
);
