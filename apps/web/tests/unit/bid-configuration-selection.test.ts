import { describe, expect, it } from 'vitest';

import {
  type BidConfiguration,
  buildBoundToolHref,
  parseBoundToolSelection,
} from '../../lib/bid-configuration-selection';

const CONFIGURATION: BidConfiguration = {
  bidYear: 2027,
  bidYearStatus: 'configuring',
  ruleBookVersion: '2027.2',
  positionTemplateVersion: '2027.1',
  configurationRevision: 4,
  ruleBookRevision: 9,
  settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
  lifecycle: 'DRAFT',
};

describe('bound Bid Setup tool selection', () => {
  it('serializes the designated year, rule book, template, and revision into downstream tool links', () => {
    expect(buildBoundToolHref('/admin/positions', CONFIGURATION)).toBe(
      '/admin/positions?year=2027&rule_book_version=2027.2&template_version=2027.1&configuration_revision=4',
    );
  });

  it('parses only a complete explicit selection and never supplies a default rule book/template', () => {
    expect(
      parseBoundToolSelection({
        year: '2027',
        rule_book_version: '2027.2',
        template_version: '2027.1',
        configuration_revision: '4',
      }),
    ).toEqual({
      year: 2027,
      ruleBookVersion: '2027.2',
      positionTemplateVersion: '2027.1',
      configurationRevision: 4,
    });
    expect(parseBoundToolSelection({ year: '2027' })).toBeNull();
    expect(
      parseBoundToolSelection({
        year: '2027',
        rule_book_version: '2027.2',
        template_version: '2027.1',
        configuration_revision: 'not-a-revision',
      }),
    ).toBeNull();
  });
});
