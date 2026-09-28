// @vitest-environment jsdom
import { existsSync } from 'node:fs';
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
    expect(markup).toContain('Pre-cutoff production reference');
    expect(markup).toContain('Mock Bid check');
  });
});
