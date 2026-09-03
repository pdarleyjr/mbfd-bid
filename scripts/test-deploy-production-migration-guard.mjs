import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../.github/workflows/deploy-production.yml', import.meta.url),
  'utf8',
);
const guard = readFileSync(
  new URL('./assert-production-d1-migration-guard.mjs', import.meta.url),
  'utf8',
);

assert.match(workflow, /workflow_dispatch:/i, 'production deployment must be manually dispatched');
assert.doesNotMatch(
  workflow,
  /\n\s{2}(?:push|pull_request):/i,
  'production workflow must not auto-deploy',
);
assert.match(
  workflow,
  /node\s+scripts\/assert-production-d1-migration-guard\.mjs/i,
  'production deployment must invoke the fail-closed migration guard',
);
assert.doesNotMatch(
  workflow,
  /\bwrangler\s+d1\s+migrations\s+apply\b/i,
  'production deployment must not batch-apply migrations without the controlled backup procedure',
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
assert.match(guard, /mbfd-bid-production/i, 'the guard must query production D1');

process.stdout.write(
  'PASS: production deployment is manual-only and guarded against batch D1 migration apply.\n',
);
