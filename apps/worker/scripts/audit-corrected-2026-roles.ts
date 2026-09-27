import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildCorrected2026SemanticRoles } from '../src/lib/corrected-2026-semantic-roles.js';
import {
  CORRECTED_2026_FLOAT_CAPTAIN_PROVENANCE,
  buildCorrected2026Topology,
} from '../src/lib/corrected-2026-topology.js';

const positions = buildCorrected2026Topology();
const roles = buildCorrected2026SemanticRoles();
const families = Object.fromEntries(
  [...new Set(roles.map((role) => role.roleFamily))]
    .sort()
    .map((family) => [family, roles.filter((role) => role.roleFamily === family).length]),
);
const output = resolve(
  import.meta.dirname,
  '../../../docs/unified-platform/2026-corrected-semantic-roles.json',
);
await writeFile(
  output,
  `${JSON.stringify(
    {
      status: 'POSITION_ROLES_CLASSIFIED_RULES_NOT_APPROVED_NOT_PRODUCTION',
      master_source_positions: 228,
      corrected_organizational_positions: positions.length,
      corrected_biddable_positions: roles.filter((role) => role.bidParticipation === 'BIDDABLE')
        .length,
      role_families: families,
      float_captain_provenance: CORRECTED_2026_FLOAT_CAPTAIN_PROVENANCE,
      positions: roles,
    },
    null,
    2,
  )}\n`,
);
