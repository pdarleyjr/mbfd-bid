export type GuideVisual = {
  src: string;
  alt: string;
  caption: string;
  markers: readonly string[];
};

const visual = (
  name: string,
  alt: string,
  caption: string,
  markers: readonly string[],
): GuideVisual => ({ src: `/manual/guide/${name}.png`, alt, caption, markers });

/** Cropped, redacted production captures from release 0c360901. */
export const GUIDE_VISUALS: Readonly<Record<string, readonly GuideVisual[]>> = {
  '2026-bid-quick-start': [
    visual(
      'quick-start',
      'Saved 2026 Current Bid with highlighted version and Mock tab',
      'Start at the saved 2026 Bid.',
      ['Confirm Version 9.', 'Open Mock Bid for training.'],
    ),
    visual(
      'mock',
      'Mock Bid readiness control',
      'Check Mock readiness before creating a rehearsal.',
      ['Run the read-only Mock check.'],
    ),
  ],
  'current-bid-edit': [
    visual(
      'current-bid',
      '2026 Current Bid with saved version and Bid workspace tabs',
      'This screen is the entry point for the saved annual Bid.',
      ['Confirm the saved version.', 'Choose the workspace tab.'],
    ),
    visual(
      'mock',
      'Mock readiness control in the 2026 Bid workspace',
      'The Mock tab is safe for a pre-cutoff rehearsal.',
      ['Check Mock readiness.'],
    ),
    visual(
      'live',
      'Read-only Managed Live preflight control',
      'Live readiness is a separate check and does not start Real.',
      ['Check Managed Live readiness only when reviewing blockers.'],
    ),
  ],
  'current-bid-blueprint': [
    visual(
      'positions',
      'Bid Blueprint Opportunities lens and participation nodes',
      'Inspect opportunities in the Bid Blueprint.',
      ['Choose Opportunities.', 'Open a node for its authored participation.'],
    ),
    visual(
      'b703',
      'Redacted production Mock roster showing B703 as Rescue Float Lieutenant number three',
      'The reviewed B703 Lieutenant seat was awarded in the current Mock.',
      ['Confirm the B703 Lieutenant label and picked status.'],
    ),
  ],
  'current-bid-mock': [
    visual(
      'mock',
      'Mock Bid check on the 2026 workspace',
      'Run the Mock check, then create and open a rehearsal from this saved version.',
      ['Select Check Mock readiness.'],
    ),
  ],
  'current-bid-live-preflight': [
    visual(
      'live',
      'Read-only Managed Live preflight control',
      'The Live check evaluates blockers. It does not create or start Real.',
      ['Select Check Managed Live readiness.'],
    ),
  ],
  'current-bid-results': [
    visual(
      'results',
      'Results tab in the saved 2026 Bid workspace',
      'Open Results and select the exact run before reviewing awards.',
      ['Open Results.'],
    ),
  ],
  'department-credentials': [
    visual(
      'credentials',
      'Credential catalog and member evidence controls',
      'Catalog defaults and member qualification evidence are different records.',
      ['Record qualification evidence for a member.', 'Edit the catalog definition separately.'],
    ),
  ],
  targetsolutions: [
    visual(
      'credential-import',
      'Approved qualification report upload and saved import controls',
      'Compare an approved TeleStaff or TargetSolutions report before applying it.',
      ['Choose an approved source report.', 'Resume a saved comparison if one exists.'],
    ),
  ],
  'qualification-review': [
    visual(
      'eligibility',
      'Qualification evidence review form and source fields',
      'Stage source evidence, then review exceptions and apply only accepted rows.',
      ['Identify the source and member.', 'Stage the row for review.'],
    ),
  ],
  'eligibility-preview': [
    visual(
      'eligibility',
      'Qualification source fields and review workflow',
      'Review authoritative evidence before interpreting the server eligibility preview.',
      ['Verify the source and dates.', 'Review accepted evidence.'],
    ),
  ],
  'positions-rules': [
    visual(
      'positions',
      'Bid Blueprint Opportunities lens',
      'For a saved annual Bid, inspect the versioned opportunity topology here.',
      ['Open Opportunities.', 'Inspect a position node.'],
    ),
    visual(
      'b703',
      'Redacted roster proof of the B703 Lieutenant seat',
      'B703 is a Lieutenant opportunity in the corrected 2026 topology.',
      ['Confirm the rank and seat code.'],
    ),
  ],
  credentials: [
    visual(
      'credentials',
      'Credential catalog and default points',
      'Definition defaults do not change frozen annual Bid scoring.',
      ['Open member evidence.', 'Edit the definition only when intended.'],
    ),
  ],
  'mock-bids': [
    visual(
      'console',
      'Redacted Mock operator console and isolated writeback banner',
      'Always verify the red MOCK banner and current turn before an action.',
      ['Confirm MOCK, not live.', 'Review the current turn.', 'Confirm isolated writeback.'],
    ),
  ],
  'live-bid': [
    visual(
      'console',
      'Redacted Mock operator console with current turn controls',
      'This production capture demonstrates the rehearsal controls.',
      ['Confirm the run type.', 'Review member and stage.', 'Check finalization status.'],
    ),
  ],
  'specialty-adjudication': [
    visual(
      'specialties',
      'Bid Blueprint lenses for specialty and opportunity structure',
      'Inspect saved specialty and opportunity rules before a Mock choice.',
      ['Open the Specialty lens.', 'Open Opportunities to inspect affected seats.'],
    ),
  ],
  'current-bid-execution-rules': [
    visual(
      'a-day',
      'Redacted selection form with position and A-Day fields',
      'The A-Day options depend on the selected eligible seat.',
      ['Choose the opportunity.', 'Choose a displayed A-Day.'],
    ),
  ],
  'results-audit': [
    visual(
      'results',
      '2026 Results workspace tab',
      'Select the exact session to inspect awards and audit.',
      ['Open Results.'],
    ),
  ],
  exports: [
    visual(
      'results',
      '2026 Results workspace tab',
      'From the reviewed session, open its exports.',
      ['Choose the exact run.'],
    ),
  ],
};

export function guideVisualsFor(id: string): readonly GuideVisual[] {
  return GUIDE_VISUALS[id] ?? [];
}
