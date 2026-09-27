import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import referenceCredentials from '../seed/fixtures/reference_credentials.json';
import { buildCorrected2026DraftRules } from '../src/lib/corrected-2026-draft-rules.js';

const draft = buildCorrected2026DraftRules();
const catalog = new Set(referenceCredentials.map((credential) => credential.name));
const citedCredentials = new Set(
  draft.rules.flatMap((rule) => [
    ...rule.requiredCriteria.credentials,
    ...(rule.requiredCriteria.postAward ?? []).map((obligation) => obligation.credential),
    ...(rule.pointsPreference.scoring?.total ?? []).flatMap((group) => [
      ...(group.excludesAny ?? []),
      ...group.items.flatMap((item) => [
        item.credential,
        ...item.requiresAll,
        ...item.alternatives,
      ]),
      ...(group.preference?.criteria ?? []).flatMap((criterion) => [
        criterion.credential,
        ...criterion.requiresAll,
        ...criterion.alternatives,
      ]),
    ]),
    ...(rule.pointsPreference.scoring?.orderedPreference?.criteria ?? []).flatMap((criterion) => [
      criterion.credential,
      ...criterion.alternatives,
      ...criterion.requiresAll,
    ]),
  ]),
);
const missingCatalogCredentials = [...citedCredentials].filter((name) => !catalog.has(name)).sort();
const output = resolve(
  import.meta.dirname,
  '../../../docs/unified-platform/2026-corrected-draft-rule-audit.json',
);
await writeFile(output, `${JSON.stringify({ ...draft, missingCatalogCredentials }, null, 2)}\n`);
