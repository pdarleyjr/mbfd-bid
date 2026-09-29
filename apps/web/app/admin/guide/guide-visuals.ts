export type GuideVisual = {
  src: string;
  alt: string;
  caption: string;
  markers: readonly string[];
  captureReference: string;
};

const visual = (
  name: string,
  alt: string,
  caption: string,
  markers: readonly string[],
): GuideVisual => ({
  src: `/manual/guide/${name}.png`,
  alt,
  caption,
  markers,
  captureReference: [
    'member-eligibility-result',
    'specialty-configuration-review',
    'specialty-interruption-review',
    'specialty-no-immediate-aday',
    'deferred-aday-control',
    'deferred-aday-result',
    'correction-review',
    'correction-audit',
    'finalization-control',
    'finalization-audit',
    'assignment-term-source',
    'recovered-mock-receipt',
  ].includes(name)
    ? 'Cropped and redacted production capture · September 2026'
    : [
          'audit-export',
          'verified-exports',
          'investigator-fallback',
          'console-actions',
          'a-day-config',
          'points-editor',
          'operator-authority',
          'participants-flow',
        ].includes(name)
      ? 'Production capture · e60c03a'
      : [
            'opportunity-edit',
            'requirement-edit',
            'live-readiness',
            'results-detail',
            'mock-ready-detail',
            'credential-comparison',
          ].includes(name)
        ? 'Pre-cutoff production capture · exact build not recorded'
        : 'Production capture · 0c360901',
});

/** Cropped, redacted production captures with per-figure provenance. */
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
    visual(
      'participants-flow',
      'Saved 2026 Bid stage ordering domains',
      'Review the rank and seniority domain before the Mock.',
      ['Check stage order.', 'Confirm Firefighter department-service order.'],
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
    visual(
      'participation',
      'Review opportunity participation control',
      'Open participant and opportunity reviews from the saved Bid workspace.',
      ['Review opportunity participation.', 'Review participants.'],
    ),
    visual(
      'participants-flow',
      'Saved stage seniority domains',
      'Firefighters use the reviewed department-service Bid ordinal.',
      ['Review each stage order.', 'Inspect participant counts in the live review.'],
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
  'current-bid-versions': [
    visual(
      'versions',
      'Version history control on the saved 2026 Bid',
      'Open version history to confirm the exact saved source and hash.',
      ['Open Version history.', 'Read back the selected saved version.'],
    ),
  ],
  'current-bid-new-annual': [
    visual(
      'versions',
      'New Annual Bid control beside the saved version',
      'Start future-year rollover from a reviewed saved structure.',
      [
        'Confirm the source year and version.',
        'Choose New Annual Bid only for the intended new year.',
      ],
    ),
  ],
  'bid-evidence': [
    visual(
      'bid-evidence',
      'Bid ordinal and completed Days tour evidence editor',
      'Use reviewed source evidence for Bid order and completed Days tours.',
      ['Inspect certified Bid ordinals.', 'Record reviewed Days tour evidence.'],
    ),
  ],
  'current-bid-mock': [
    visual(
      'mock',
      'Mock Bid check on the 2026 workspace',
      'Run the Mock check, then create and open a rehearsal from this saved version.',
      ['Select Check Mock readiness.'],
    ),
    visual(
      'mock-ready-detail',
      'Version 9 Mock readiness and creation controls',
      'Create a Mock only after the exact saved version passes readiness.',
      ['Check Mock readiness.', 'Create the isolated Mock.'],
    ),
  ],
  'catalog-import': [
    visual(
      'credential-import',
      'Qualification import and saved comparison controls',
      'Preview source changes before applying reviewed member evidence.',
      ['Choose an approved report.', 'Review the saved comparison.'],
    ),
  ],
  'member-import': [
    visual(
      'credential-import',
      'Import workflow entry and source review controls',
      'Use the approved import workflow for the intended personnel source.',
      ['Choose the source.', 'Review the comparison before apply.'],
    ),
  ],
  'current-bid-results': [
    visual(
      'results',
      'Results tab in the saved 2026 Bid workspace',
      'Open Results and select the exact run before reviewing awards.',
      ['Open Results.'],
    ),
    visual(
      'results-detail',
      'Results panel with exact Mock run selector',
      'Choose the exact run before reading completion and exports.',
      ['Confirm Mock run identity.', 'Review completion and projection.'],
    ),
  ],
  'rules-list': [
    visual(
      'requirement-edit',
      'Required qualification checklist in opportunity editor',
      'Required qualifications belong to the annual opportunity rule.',
      ['Select the opportunity.', 'Review requirements and points separately.'],
    ),
    visual(
      'points-editor',
      'Annual Bid scoring channels and cumulative preference controls',
      'Points and preferences are edited in the annual opportunity, not the credential catalog.',
      ['Choose a scoring channel.', 'Review its cumulative preferences.'],
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
    visual(
      'credential-comparison',
      'Saved credential comparison counts and exception review',
      'Review reconciled and rejected source rows before applying ready records.',
      ['Inspect the source date and comparison.', 'Resolve rejected records individually.'],
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
      'requirement-edit',
      'Annual opportunity required qualification controls',
      'Confirm the saved rule before reviewing the server eligibility result.',
      [
        'Inspect required qualifications.',
        'Use the server preview for member-specific eligibility.',
      ],
    ),
    visual(
      'member-eligibility-result',
      'Cropped secondary eligibility preview with its evaluated rule and reason',
      'Read the server result for the selected member and rule book. This illustrative secondary-tool capture does not establish eligibility in the saved Current Bid.',
      [
        'Confirm the member and rule book.',
        'Read the rule reason before changing source evidence.',
      ],
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
      'opportunity-edit',
      'Annual opportunity participation and staffing connection fields',
      'Edit participation and Department connection in the saved Bid workspace.',
      ['Select an opportunity.', 'Review bid participation and staffing connection.'],
    ),
    visual(
      'requirement-edit',
      'Annual position required qualification fields',
      'Review the position rule and qualification requirements before saving.',
      ['Inspect required qualifications.'],
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
    visual(
      'console-actions',
      'Completed isolated Mock console action controls',
      'The named operator panels separate selection, A-Day, specialty, and correction actions.',
      ['Open the intended panel.', 'Verify the canonical receipt after action.'],
    ),
    visual(
      'a-day',
      'Mock normal selection form with A-Day choices',
      'A normal selection uses a displayed valid A-Day.',
      ['Choose an eligible position.', 'Select a displayed A-Day.'],
    ),
    visual(
      'contact-return',
      'Mock disposition, contact and return dialog',
      'Record simulated contact or return only through the audited action panel.',
      ['Enter a reason and evidence when required.', 'Review the current member before commit.'],
    ),
    visual(
      'correction-review',
      'Redacted Mock correction review showing the original and proposed selection',
      'Confirm the exact member, seat and A-Day before recording a correction.',
      ['Review the original selection.', 'Confirm the replacement and reason.'],
    ),
    visual(
      'correction-audit',
      'Cropped audit receipt for an accepted Mock correction',
      'A correction appends an audited event to the same isolated Mock.',
      ['Verify the corrected award.', 'Read the audit receipt.'],
    ),
  ],
  'live-bid': [
    visual(
      'live-readiness',
      'Managed Live readiness blocker panel',
      'Read the server Live preflight and resolve each listed blocker before any Real start.',
      ['Run Check Managed Live readiness.', 'Follow the blocker evidence path.'],
    ),
    visual(
      'operator-authority',
      'Annual Bid authority and permission editor',
      'Action grants must be reviewed before Live.',
      ['Confirm named operator grants.', 'Rerun read-only preflight.'],
    ),
  ],
  'current-bid-execution-rules': [
    visual(
      'a-day',
      'Redacted selection form with position and A-Day fields',
      'The A-Day options depend on the selected eligible seat.',
      ['Choose the opportunity.', 'Choose a displayed A-Day.'],
    ),
    visual(
      'investigator-fallback',
      'Fire Investigator fallback tier configuration in the saved 2026 Bid',
      'The frozen Investigator tier uses current assignees and reverse department-service order while retaining opportunity minimums.',
      ['Confirm current-assignee scope.', 'Confirm higher Bid ordinals first.'],
    ),
    visual(
      'a-day-config',
      'A-Day timing exception and policy source in the saved 2026 Bid',
      'The specialized-award timing exception is source-backed and separate from normal selection.',
      ['Review the exception name and source.', 'Verify its timing in the saved Bid.'],
    ),
    visual(
      'specialty-configuration-review',
      'Cropped annual specialty rule configuration and source review',
      'Review the frozen specialty scope and source before an interruption.',
      ['Confirm the affected opportunity.', 'Read the policy source.'],
    ),
    visual(
      'deferred-aday-control',
      'Cropped deferred A-Day action control for an accepted specialty award',
      'A source-backed exception can postpone the A-Day until after the position award.',
      ['Confirm the frozen exception.', 'Open the later A-Day action for the awarded member.'],
    ),
    visual(
      'deferred-aday-result',
      'Cropped receipt after a deferred A-Day was recorded',
      'Verify the later A-Day receipt before treating the selection as complete.',
      ['Read the recorded A-Day.', 'Verify the audited result.'],
    ),
    visual(
      'points-editor',
      'Annual Bid point and preference editor',
      'Use the Bid rule scoring channels for this version.',
      ['Select the correct channel.', 'Review points before saving.'],
    ),
  ],
  exports: [
    visual(
      'results',
      '2026 Results workspace tab',
      'From the reviewed session, open its exports.',
      ['Choose the exact run.'],
    ),
    visual(
      'verified-exports',
      'Verified September 28 shift PDFs and audit CSV in the export list',
      'Use the regenerated shift PDFs and complete audit export for the exact Mock session.',
      ['Check generated file timestamps.', 'Keep the earlier invalid PDFs quarantined.'],
    ),
    visual(
      'audit-export',
      'Completed full audit CSV export receipt',
      'Generate the full audit file from the reviewed run.',
      ['Generate Full Audit CSV.', 'Verify the completed export receipt.'],
    ),
  ],
  'source-decisions': [
    visual(
      'source-review',
      '2026 source decisions and changes review page',
      'Open the source decision record and inspect its policy basis.',
      ['Review source checks.', 'Record an approved resolution with its reason.'],
    ),
  ],
  readiness: [
    visual(
      'mock-ready-detail',
      'Read-only Version 9 Mock readiness result',
      'Mock readiness verifies the saved version used for rehearsal.',
      ['Run the check.', 'Read the exact version and blockers.'],
    ),
  ],
  'bid-setup': [
    visual(
      'current-bid',
      'Saved 2026 Bid workspace',
      'The current Bid workspace holds versioned setup and readiness.',
      ['Confirm 2026 and Version 9.', 'Open the intended editing section.'],
    ),
  ],
  'annual-policy': [
    visual(
      'investigator-fallback',
      'Saved 2026 Investigator fallback policy controls',
      'Review the exact source-backed fallback tier in the annual policy.',
      ['Confirm the source decision.', 'Verify candidate scope and comparator.'],
    ),
  ],
  'rule-books': [
    visual(
      'requirement-edit',
      'Opportunity requirements in the saved Bid rule editor',
      'Rule changes require a reviewed saved version before a new Mock.',
      ['Review requirements.', 'Preview affected seats before saving.'],
    ),
    visual(
      'points-editor',
      'Annual opportunity scoring channels',
      'Points belong to the annual Bid rule.',
      ['Choose total, Special Operations, or Marine channel.', 'Review cumulative preferences.'],
    ),
  ],
  'specialty-adjudication': [
    visual(
      'specialties',
      'Bid Blueprint specialty structure',
      'Inspect saved specialty rules before operating an interruption.',
      ['Open the Specialty lens.', 'Inspect affected opportunities.'],
    ),
    visual(
      'specialty-contact',
      'Specialty and contact review panel with a rejected attempted interruption',
      'Start specialty review only for a displayed eligible interruption; this captured attempt was rejected by frozen policy.',
      ['Check member and target opportunity.', 'Treat a rejection as no recorded award.'],
    ),
    visual(
      'specialty-interruption-review',
      'Redacted accepted specialty interruption and ordered candidate review',
      'Read the candidate order and suspended bidder state before each response.',
      ['Confirm the requested specialty seat.', 'Review the current candidate and queue.'],
    ),
    visual(
      'specialty-no-immediate-aday',
      'Cropped accepted specialty award with a deferred A-Day state',
      'The approved timing exception permits the award before its later A-Day.',
      ['Verify one accepted award.', 'Check the pending A-Day state.'],
    ),
  ],
  'current-bid-live-preflight': [
    visual(
      'live-readiness',
      'Read-only Managed Live preflight blocker panel',
      'Inspect server blockers and linked source evidence before a Real session.',
      ['Check Managed Live readiness.', 'Review each named blocker.'],
    ),
    visual(
      'operator-authority',
      'Annual Bid operator authority editor',
      'Confirm named action grants separately from general admin access.',
      ['Review operator grants.', 'Run the server preflight again.'],
    ),
  ],
  'results-audit': [
    visual(
      'results-detail',
      'Exact Mock run selected in Results',
      'Review completion, awards and projection for the selected session.',
      ['Confirm the run ID.', 'Inspect completion and finalization.'],
    ),
    visual(
      'audit-export',
      'Full audit export completion receipt',
      'Audit exports are tied to the selected run.',
      ['Generate the full audit file.', 'Verify the completed receipt.'],
    ),
    visual(
      'finalization-control',
      'Cropped Mock finalization control for the selected run',
      'Review the exact run and its completion checks before finalizing.',
      ['Confirm the Mock run.', 'Read the completion control.'],
    ),
    visual(
      'finalization-audit',
      'Cropped immutable completion receipt for a finalized Mock',
      'Use the finalization event and export to reconcile the selected run.',
      ['Verify the completion event.', 'Compare award totals with the export.'],
    ),
  ],
  'bid-advisory': [
    visual(
      'console-actions',
      'Mock operator console with named action panels',
      'The advisory explains frozen state beside canonical controls.',
      ['Read the current member and state.', 'Use the named canonical action panel.'],
    ),
  ],
  'live-presentation': [
    visual(
      'console-actions',
      'Isolated Mock console action panels',
      'Use the presentation panel only within the run type shown by its banner.',
      ['Confirm Mock or Live.', 'Open Presentation.'],
    ),
  ],
  'troubleshooting-safety': [
    visual(
      'console-actions',
      'Mock correction and recovery entry points',
      'After an uncertain response, check the canonical roster and audit before retrying.',
      ['Open Correct selection when needed.', 'Check the existing receipt.'],
    ),
    visual(
      'audit-export',
      'Audit export receipt',
      'Use the audited result to resolve uncertain commands.',
      ['Confirm the exact session.', 'Compare its sequence and audit.'],
    ),
    visual(
      'contact-return',
      'Disposition, contact and return panel',
      'Recover an interrupted contact action from its recorded receipt.',
      ['Check whether the action persisted.', 'Retry only when no canonical receipt exists.'],
    ),
    visual(
      'recovered-mock-receipt',
      'Cropped canonical Mock receipt after a reconnect',
      'After an uncertain response, verify whether the action was accepted before retrying.',
      ['Read the current session state.', 'Match the existing audit receipt.'],
    ),
  ],
  tenure: [
    visual(
      'live-readiness',
      'Managed Live assignment-term evidence blocker',
      'Supply reviewed term evidence in the linked source workspace before Live.',
      ['Read the named blocker.', 'Review the assignment term evidence.'],
    ),
    visual(
      'assignment-term-source',
      'Cropped assignment-term evidence source and inclusive-date controls',
      'A reviewed source must support the exact protected term and dates.',
      ['Select the authorized seat.', 'Enter the source and inclusive dates.'],
    ),
  ],
  'award-transition': [
    visual(
      'results-detail',
      'Mock Results completion and assignment transition panel',
      'A Mock projection stays separate from Department assignments.',
      ['Review the exact run.', 'Resolve Live-only transition blockers separately.'],
    ),
  ],
  'department-roster': [
    visual(
      'participation',
      'Saved Bid opportunity participation review',
      'Bid participation is separate from Department staffing.',
      ['Review biddable and administrative participation.', 'Confirm the staffing connection.'],
    ),
  ],
  'service-evidence': [
    visual(
      'bid-evidence',
      'Reviewed Bid ordinals and Days tour controls',
      'Service and tour evidence must come from an accepted source.',
      ['Inspect the source-certified ordinals.', 'Review completed Days tour evidence.'],
    ),
  ],
  'qualification-evidence': [
    visual(
      'eligibility',
      'Dated qualification evidence review controls',
      'Review member evidence before interpreting an eligibility result.',
      ['Confirm source and dates.', 'Review exceptions.'],
    ),
  ],
  'personnel-operations': [
    visual(
      'bid-evidence',
      'Bid evidence capture controls',
      'Review dated assignment and service facts before a personnel change affects a future Bid.',
      ['Check source evidence.', 'Review the effective date.'],
    ),
  ],
  'annual-plan': [
    visual(
      'versions',
      'New Annual Bid and version history controls',
      'Carry forward a reviewed saved structure for the next annual Bid.',
      ['Read back the current saved version.', 'Choose New Annual Bid for the future year.'],
    ),
  ],
  'common-workflows': [
    visual(
      'current-bid',
      'Current Bid workspace',
      'Start in the saved Bid and follow the workflow link for the intended task.',
      ['Confirm year and version.', 'Open the matching workspace.'],
    ),
  ],
};

export function guideVisualsFor(id: string): readonly GuideVisual[] {
  return GUIDE_VISUALS[id] ?? [];
}
