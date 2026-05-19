import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Defaults to the vendored copy inside apps/worker so local + CI both work
// without env vars; override with BID_DOCS_DIR for a different source.
const BID_DOCS = process.env.BID_DOCS_DIR ?? resolve(here, '../../../docs/bid-docs/2026');

const sources = [
  { title: 'Bid Process', path: '2026_Bid_Process.md' },
  { title: 'Rules & Points', path: '2026_Rules_and_Points.md' },
  { title: 'Position Template', path: '2026_Position_Template.md' },
];

const body = sources
  .map((s) => {
    const raw = readFileSync(resolve(BID_DOCS, s.path), 'utf8');
    return `<!-- BEGIN ${s.title} (${s.path}) -->\n${raw}\n<!-- END ${s.title} -->`;
  })
  .join('\n\n---\n\n');

const out = `// AUTO-GENERATED. Do not edit by hand. Run \`pnpm --filter @mbfd/worker ai:codegen\`.
// biome-ignore format: generated single-line literal
export const RULEBOOK_2026: string = ${JSON.stringify(body)};
export const RULEBOOK_2026_VERSION = '2026.1';
`;

writeFileSync(resolve(here, 'rulebook-2026.generated.ts'), out, 'utf8');
console.info(`Wrote rulebook-2026.generated.ts (${body.length} chars)`);
