export type BidConfigurationLifecycle =
  | 'UNCONFIGURED'
  | 'DRAFT'
  | 'FROZEN'
  | 'LEGACY_EVALUATION_DATE_REQUIRED'
  | 'INCONSISTENT';

export interface BidConfiguration {
  bidYear: number;
  bidYearStatus: 'configuring' | 'live' | 'paused' | 'complete' | 'archived';
  ruleBookVersion: string | null;
  positionTemplateVersion: string | null;
  configurationRevision: number;
  ruleBookRevision: number | null;
  settings:
    | {
        v: 1;
        expectedDurationDays: number;
        turnTimerSeconds: number;
      }
    | {
        v: 2;
        expectedDurationDays: number;
        turnTimerSeconds: number;
        credentialEvaluationOn: string;
      }
    | null;
  lifecycle: BidConfigurationLifecycle;
}

export interface BoundToolSelection {
  year: number;
  ruleBookVersion: string;
  positionTemplateVersion: string;
  configurationRevision: number;
}

export type BoundToolSearchParams = {
  year?: string;
  rule_book_version?: string;
  template_version?: string;
  configuration_revision?: string;
};

const VERSION_PATTERN = /^\d{4}\.\d+$/;

function validYear(value: string | undefined): value is string {
  if (value === undefined || !/^\d{4}$/.test(value)) return false;
  const year = Number(value);
  return year >= 2024 && year <= 2100;
}

function validRevision(value: string | undefined): value is string {
  return value !== undefined && /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
}

/** A policy tool may only operate from a complete, designated annual configuration. */
export function isBoundBidConfiguration(
  configuration: BidConfiguration | null,
): configuration is BidConfiguration & {
  ruleBookVersion: string;
  positionTemplateVersion: string;
} {
  return (
    configuration !== null &&
    (configuration.lifecycle === 'DRAFT' || configuration.lifecycle === 'FROZEN') &&
    typeof configuration.ruleBookVersion === 'string' &&
    configuration.ruleBookVersion.length > 0 &&
    typeof configuration.positionTemplateVersion === 'string' &&
    configuration.positionTemplateVersion.length > 0 &&
    configuration.settings?.v === 2 &&
    Number.isSafeInteger(configuration.configurationRevision) &&
    configuration.configurationRevision >= 0
  );
}

/** Builds an explicit immutable context for a downstream setup tool. */
export function buildBoundToolHref(path: string, configuration: BidConfiguration): string | null {
  if (!isBoundBidConfiguration(configuration)) return null;
  const query = new URLSearchParams({
    year: String(configuration.bidYear),
    rule_book_version: configuration.ruleBookVersion,
    template_version: configuration.positionTemplateVersion,
    configuration_revision: String(configuration.configurationRevision),
  });
  return `${path}?${query.toString()}`;
}

/**
 * Requires every part of the context. There is deliberately no year, rule
 * book, template, or revision default for a policy tool route.
 */
export function parseBoundToolSelection(
  searchParams: BoundToolSearchParams,
): BoundToolSelection | null {
  const {
    year,
    rule_book_version: ruleBookVersion,
    template_version: positionTemplateVersion,
    configuration_revision: configurationRevision,
  } = searchParams;
  if (
    !validYear(year) ||
    ruleBookVersion === undefined ||
    !VERSION_PATTERN.test(ruleBookVersion) ||
    positionTemplateVersion === undefined ||
    !VERSION_PATTERN.test(positionTemplateVersion) ||
    !validRevision(configurationRevision)
  ) {
    return null;
  }
  return {
    year: Number(year),
    ruleBookVersion,
    positionTemplateVersion,
    configurationRevision: Number(configurationRevision),
  };
}

/** Verifies that a route context still names the exact server-designated selection. */
export function selectionMatchesConfiguration(
  selection: BoundToolSelection,
  configuration: BidConfiguration | null,
): boolean {
  return (
    isBoundBidConfiguration(configuration) &&
    configuration.bidYear === selection.year &&
    configuration.ruleBookVersion === selection.ruleBookVersion &&
    configuration.positionTemplateVersion === selection.positionTemplateVersion &&
    configuration.configurationRevision === selection.configurationRevision
  );
}
