// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GUIDE_SECTIONS } from '../../app/admin/guide/guide-content';
import { GUIDE_VISUALS } from '../../app/admin/guide/guide-visuals';
import { GuideVisuals } from '../../components/admin/GuideVisuals';

describe('annotated administrator help', () => {
  it('ships local images for every referenced visual and covers the requested workflows', () => {
    const topics = new Set(GUIDE_SECTIONS.map((section) => section.id));
    const mustIllustrate = [
      '2026-bid-quick-start',
      'current-bid-edit',
      'current-bid-blueprint',
      'department-credentials',
      'qualification-review',
      'current-bid-mock',
      'mock-bids',
      'current-bid-execution-rules',
      'specialty-adjudication',
      'current-bid-results',
      'current-bid-live-preflight',
    ];
    for (const id of mustIllustrate) expect(GUIDE_VISUALS[id]?.length).toBeGreaterThan(0);
    for (const [id, visuals] of Object.entries(GUIDE_VISUALS)) {
      expect(topics.has(id)).toBe(true);
      for (const visual of visuals) {
        expect(visual.src).toMatch(/^\/manual\/guide\/[a-z0-9-]+\.png$/);
        expect(existsSync(join(process.cwd(), 'public', visual.src))).toBe(true);
        expect(visual.markers.length).toBeGreaterThan(0);
        expect(visual.alt.length).toBeGreaterThan(10);
      }
    }
  });

  it('renders visual actions and the pre-cutoff capture boundary with accessible text', () => {
    const markup = renderToStaticMarkup(<GuideVisuals topicId="current-bid-mock" />);
    expect(markup).toContain('Visual instructions');
    expect(markup).toContain('Check Mock readiness');
    expect(markup).toContain('Production capture · 0c360901');
    expect(markup).toContain('Pre-cutoff production capture · exact build not recorded');
    expect(markup).toContain('Mock Bid check');
  });

  it('keeps the new production help captures tied to their reviewed source receipts', () => {
    const provenancePath = join(
      process.cwd(),
      '..',
      '..',
      'docs',
      'unified-platform',
      '2026-inapp-help-capture-provenance-20260929.json',
    );
    const provenance = JSON.parse(readFileSync(provenancePath, 'utf8')) as {
      assets: Array<{ name: string; outputSha256: string }>;
    };
    expect(provenance.assets).toHaveLength(12);
    const referenced = new Set(
      Object.values(GUIDE_VISUALS)
        .flat()
        .map((visual) => visual.src),
    );
    for (const asset of provenance.assets) {
      const src = `/manual/guide/${asset.name}.png`;
      expect(referenced.has(src)).toBe(true);
      const bytes = readFileSync(join(process.cwd(), 'public', src));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.outputSha256);
    }
  });
});
