export type GuideSection = {
  id: string;
  category: string;
  title: string;
  route: string;
  routeLabel: string;
  summary: string;
  controls: readonly string[];
  steps: readonly string[];
  important?: string;
  keywords: readonly string[];
};

const section = (value: GuideSection) => value;

/**
 * Administrator-facing content. Keep this close to the routed Admin surface:
 * routes are intentionally static so a guide link cannot expose an arbitrary
 * member, session, or internal record identifier.
 */
export const GUIDE_SECTIONS: readonly GuideSection[] = [
  section({
    id: 'getting-started',
    category: 'Start here',
    title: 'Getting started',
    route: '/admin',
    routeLabel: 'Dashboard',
    summary:
      'Use Bid through your authorized MBFD Hub sign-in. The Admin Console is for year-round staffing administration and controlled Bid operations.',
    controls: ['Admin navigation', 'Navigation button on mobile', 'Sidebar links'],
    steps: [
      'Enter Bid from MBFD Hub with your authorized account.',
      'Use the left navigation on desktop; select Navigation on a phone or tablet.',
      'Use Mock Bids for rehearsal. Live Bid is a separate, operator-only workspace.',
    ],
    important:
      'Hub authentication and the Bid Access PIN serve different purposes. Never treat a PIN as a Hub sign-in method.',
    keywords: ['login', 'hub', 'sidebar', 'mobile navigation', 'year round', 'mock vs real bid'],
  }),
  section({
    id: 'dashboard',
    category: 'Start here',
    title: 'Dashboard',
    route: '/admin',
    routeLabel: 'Dashboard',
    summary:
      'The dashboard is the control-center landing page. Read its status cards and use its shortcuts to move into the area that needs attention.',
    controls: ['Status cards', 'Operational shortcuts', 'Admin navigation'],
    steps: [
      'Review the status shown before making a change.',
      'Use a shortcut to open the related workspace.',
      'Follow blocked or unavailable notices instead of working around them.',
    ],
    important:
      'A dashboard status is an operational signal, not authorization to start a live Bid or change controlled records.',
    keywords: ['status', 'cards', 'shortcuts', 'attention'],
  }),
  section({
    id: 'current-rosters',
    category: 'Year-round staffing',
    title: 'Current Rosters',
    route: '/admin/current-rosters',
    routeLabel: 'Current Rosters',
    summary:
      'View the reviewed operational staffing projection by A, B, C, D, or all shifts, including vacancies and people not assigned to a reviewed seat.',
    controls: [
      'Search',
      'Shift selector',
      'As-of date',
      'Vacancies and unassigned filters',
      'Reset filters',
      'CSV download',
      'Print roster',
    ],
    steps: [
      'Choose an effective date and shift scope.',
      'Use search and the vacancy or unassigned filters to narrow the projection.',
      'Review the roster summary, then download CSV or open the print view when an export is needed.',
    ],
    important:
      'This page reports the reviewed projection. Resolve a staffing question in its source workflow rather than editing a roster display.',
    keywords: [
      'roster',
      'a shift',
      'b shift',
      'c shift',
      'd shift',
      'vacancy',
      'unassigned',
      'csv',
      'print',
      'pdf',
      'as of date',
    ],
  }),
  section({
    id: 'staffing-structure',
    category: 'Year-round staffing',
    title: 'Staffing Structure',
    route: '/admin/staffing-structure',
    routeLabel: 'Staffing Structure',
    summary:
      'Maintain authorized staffing seats and their occupancy history. An authorized seat is the approved slot; an occupant is the member assigned to that slot.',
    controls: [
      'Add authorized staffing seat form',
      'Effective-date filters',
      'Capacity and occupancy view',
      'Retire seat action',
    ],
    steps: [
      'Set the effective date before reviewing capacity.',
      'Add a seat only when the authorized structure supports it.',
      'Use the seat history and occupancy information to confirm the change.',
      'Retire a seat only with the reviewed effective date and reason.',
    ],
    important:
      'Do not create a seat just to accommodate an unmatched source row. A seat and a member assignment are separate controlled records.',
    keywords: [
      'authorized seat',
      'occupant',
      'vacant',
      'add seat',
      'retire seat',
      'reassignment',
      'effective date',
      'capacity',
    ],
  }),
  section({
    id: 'telestaff',
    category: 'Year-round staffing',
    title: 'TeleStaff',
    route: '/admin/telestaff',
    routeLabel: 'TeleStaff',
    summary:
      'TeleStaff is a controlled reconciliation workflow: upload, preview, stage, reconcile, review, and then apply only reviewed, safe results.',
    controls: [
      'Upload',
      'Preview',
      'Stage',
      'Reconcile',
      'Review',
      'Apply',
      'Designate 2026 staffing baseline',
      'Sanitized reconciliation export',
    ],
    steps: [
      'Confirm whether the source is official or synthetic and verify the snapshot date.',
      'Upload and inspect the preview before staging it.',
      'Reconcile changes, new positions, unknown employees, incomplete topology, and source mappings.',
      'Review safe exceptions and export the sanitized reconciliation package when needed.',
      'Apply only after reviewed exceptions are resolved or formally retained.',
      'After a committed official import passes completeness checks, use the two-step baseline confirmation. It will atomically supersede the prior acceptance receipt while preserving that receipt in audit history.',
    ],
    important:
      'Never invent a seat or identity for an unknown employee or incomplete topology. Baseline confirmation writes an acceptance receipt to production D1, but it does not start a Bid session and does not write back to TeleStaff.',
    keywords: [
      'telestaff',
      'upload',
      'preview',
      'stage',
      'reconcile',
      'apply',
      'unknown employee',
      'incomplete topology',
      'source mapping',
      'sanitized export',
      'baseline',
      'supersede',
    ],
  }),
  section({
    id: 'members',
    category: 'People and qualifications',
    title: 'Members and Member Roster',
    route: '/admin/members',
    routeLabel: 'Members',
    summary:
      'Find members, open their profile and assignment context, and use the Master Roster for searchable roster review and order controls where available.',
    controls: [
      'Member list',
      'Profile links',
      'Member Roster',
      'Search by name or employee ID',
      'Roster filters',
      'Move up and down controls',
    ],
    steps: [
      'Open Members to find a record.',
      'Open the member profile to review assignment context and history.',
      'Use Member Roster to search or review roster-level information.',
      'Use Personnel Changes for controlled lifecycle changes instead of treating a profile as an edit surface.',
    ],
    important:
      'Member records and their operational assignment history are not interchangeable with a staffing seat.',
    keywords: [
      'member',
      'member roster',
      'profile',
      'search member',
      'employee id',
      'history',
      'assignment context',
    ],
  }),
  section({
    id: 'credentials',
    category: 'People and qualifications',
    title: 'Credentials & Specialty Points',
    route: '/admin/credentials',
    routeLabel: 'Credentials & Specialty Points',
    summary:
      'Use the credential catalog and member credential records to understand qualification holders and specialty-point values.',
    controls: [
      'Credential catalog',
      'Holder count',
      'Member credential records',
      'Credential import workflow',
    ],
    steps: [
      'Review the credential catalog and holder count.',
      'Open the related member record to inspect qualification context.',
      'Use the controlled credential workflow when adding or changing evidence.',
      'Confirm whether you are viewing year-round values or frozen annual-Bid values.',
    ],
    important:
      'A frozen annual-Bid value is evidence for that Bid; it is not a shortcut for changing the year-round credential record.',
    keywords: ['credential', 'specialty points', 'holder count', 'member credential', 'points'],
  }),
  section({
    id: 'personnel',
    category: 'People and qualifications',
    title: 'Personnel Changes',
    route: '/admin/personnel',
    routeLabel: 'Personnel Changes',
    summary:
      'Record effective-dated personnel lifecycle and assignment changes while preserving an immutable history of what changed and why.',
    controls: [
      'Change type',
      'Effective date',
      'Member and assignment fields',
      'Reason',
      'Preview/history',
      'Temporary overlays',
    ],
    steps: [
      'Choose the reviewed change type: new hire, promotion, demotion, transfer, reassignment, retirement, separation, or correction.',
      'Set the effective date and complete the relevant member and assignment fields.',
      'Review the preview and history before committing.',
      'Record the reason and retain any policy-pending or configuration-pending status.',
    ],
    important:
      'Use a correction to correct a reviewed record; do not overwrite historical facts. Temporary overlays are distinct from permanent staffing changes.',
    keywords: [
      'new hire',
      'promotion',
      'demotion',
      'transfer',
      'reassignment',
      'retire member',
      'retirement',
      'separation',
      'correction',
      'effective date',
      'history',
    ],
  }),
  section({
    id: 'qualification-evidence',
    category: 'People and qualifications',
    title: 'Qualification Evidence & Review',
    route: '/admin/personnel/qualifications',
    routeLabel: 'Qualification Evidence',
    summary:
      'Record whether a qualification is gained, expires, or is revoked, and use the review areas to understand readiness and Bid eligibility impact.',
    controls: [
      'Qualification lifecycle',
      'Evidence fields',
      'Qualification Review',
      'Readiness view',
    ],
    steps: [
      'Open Qualification Evidence for the relevant member and qualification.',
      'Record the lifecycle event and supporting evidence.',
      'Use Qualification Review to identify items needing review.',
      'Check readiness before relying on a qualification for eligibility.',
    ],
    important:
      'Specialty-qualified status and supporting evidence must remain traceable; do not mark an unverified qualification as ready.',
    keywords: [
      'qualification',
      'gain',
      'expire',
      'revoke',
      'specialty qualified',
      'evidence',
      'readiness',
      'eligibility',
    ],
  }),
  section({
    id: 'bid-setup',
    category: 'Annual preparation',
    title: 'Bid Setup',
    route: '/admin/bid-setup',
    routeLabel: 'Bid Setup',
    summary:
      'Bid Setup organizes the annual preparation sequence and shows whether the selected year has usable configuration.',
    controls: [
      'Bid year',
      'Configuration status',
      'Rule Books',
      'Positions',
      'Rules',
      'Eligibility Preview',
      'Bid Access PIN',
    ],
    steps: [
      'Select the Bid year.',
      'Review configuration status and resolve blocking or unconfigured conditions.',
      'Prepare controlled rules, positions, policy, and eligibility before creating a session.',
      'Use the related setup links rather than bypassing a blocked configuration.',
    ],
    important: 'A year with missing or blocking configuration is not ready for live operations.',
    keywords: [
      'bid setup',
      'annual preparation',
      'configuration',
      'bid year',
      'blocking',
      'unconfigured',
    ],
  }),
  section({
    id: 'rule-books',
    category: 'Annual preparation',
    title: 'Rule Books',
    route: '/admin/rule-books',
    routeLabel: 'Rule Books',
    summary:
      'Rule Books hold controlled Bid rules as drafts and revisions. Publishing is a deliberate, protected action with a recorded reason.',
    controls: [
      'Create draft',
      'Rule Book form',
      'Revision reason',
      'Publish action',
      'Publish confirmation',
    ],
    steps: [
      'Create or open the appropriate draft.',
      'Record scope and the reviewed operational reason.',
      'Review coverage and revision details.',
      'Publish only when the authorized revision is ready.',
    ],
    important:
      'Published rules are controlled evidence. Do not publish a draft merely to make a configuration appear complete.',
    keywords: ['rule book', 'draft', 'revision', 'publish', 'published rules'],
  }),
  section({
    id: 'positions-rules',
    category: 'Annual preparation',
    title: 'Positions & Rules',
    route: '/admin/positions',
    routeLabel: 'Positions',
    summary:
      'Review configured positions by shift and open a position rule to manage participation, rank or category criteria, eligibility, and tie-break order.',
    controls: [
      'Shift position list',
      'Edit configured rule',
      'Rank checkboxes',
      'Eligibility criteria',
      'Tie-break order controls',
      'Save rule',
    ],
    steps: [
      'Choose the relevant shift and position.',
      'Open its configured rule.',
      'Review participation, category or rank, eligibility, and tie-break settings.',
      'Save only the reviewed rule change and re-check the result.',
    ],
    important: 'Position rules define eligibility; do not change them to fit an individual result.',
    keywords: [
      'position',
      'rules',
      'participation',
      'rank',
      'category',
      'eligibility',
      'tie break',
    ],
  }),
  section({
    id: 'eligibility-preview',
    category: 'Annual preparation',
    title: 'Eligibility Preview',
    route: '/admin/eligibility',
    routeLabel: 'Eligibility Preview',
    summary:
      'Eligibility Preview shows how current configuration evaluates eligibility before an award is made.',
    controls: ['Eligibility form', 'Position and member inputs', 'Preview result'],
    steps: [
      'Select the applicable configuration and subject.',
      'Run the preview.',
      'Review why the result is eligible, ineligible, or unavailable.',
      'Correct the underlying controlled record if authoritative review requires it.',
    ],
    important: 'A preview is not an award and does not change a live session.',
    keywords: ['eligibility preview', 'eligible', 'ineligible', 'preview not award'],
  }),
  section({
    id: 'bid-pin',
    category: 'Annual preparation',
    title: 'Bid Access PIN',
    route: '/admin/settings/bid-pin',
    routeLabel: 'Bid Access PIN',
    summary:
      'The Bid Access PIN is an additional operational access control used in the Bid application; it is separate from MBFD Hub authentication.',
    controls: ['PIN input', 'Change PIN button'],
    steps: [
      'Confirm you are authorized to change the PIN.',
      'Enter the new approved PIN in the protected form.',
      'Complete the change and communicate it only through the approved channel.',
    ],
    important: 'Do not share a PIN in this guide, in exports, or in regular administrative notes.',
    keywords: ['pin', 'change pin', 'bid access', 'hub authentication'],
  }),
  section({
    id: 'annual-policy',
    category: 'Annual preparation',
    title: 'Annual Policy',
    route: '/admin/annual-policy',
    routeLabel: 'Annual Policy',
    summary:
      'Annual Policy builds an executable, versioned policy for Bid stages, order, specialty handling, dispositions, contact requirements, A-Day limits, and revision evidence.',
    controls: [
      'Policy version',
      'Bid stages and order',
      'Live action authority',
      'Disposition rules',
      'Contact policy',
      'Specialty policy',
      'A-Day limits',
      'Preview and revision history',
    ],
    steps: [
      'Start with the approved year and policy version.',
      'Configure and order stages, specialty policy, dispositions, contacts, and A-Day limits.',
      'Review blocking or unconfigured status and correct it through the approved policy process.',
      'Use preview and revision history before publishing or freezing evidence.',
    ],
    important:
      'Keep policy-pending and unconfigured states visible. A frozen policy preserves what governed that annual Bid.',
    keywords: [
      'annual policy',
      'change bid order',
      'stages',
      'specialty policy',
      'disposition',
      'contact policy',
      'a-day',
      'frozen policy',
      'policy pending',
    ],
  }),
  section({
    id: 'bid-advisory',
    category: 'Rehearse and operate',
    title: 'BID Advisory',
    route: '/admin/bid',
    routeLabel: 'Live Bid & Advisory',
    summary:
      'BID Advisory explains the current authoritative session, candidate order, position state, eligibility result, specialty interruption, A-Day result, and staffing boundary with deterministic application text.',
    controls: ['Read-only advisory cards', 'Evidence-source labels', 'Authoritative sequence'],
    steps: [
      'Open Live Bid & Advisory for the active or selected session.',
      'Read the advisory sequence and evidence labels with the live board.',
      'Use the controlled Bid workspace for any authorized operational action.',
    ],
    important:
      'The composer explains existing BID results. It does not accept prompts, calculate a second outcome, make a selection, or change staffing, policy, assignments, or session state.',
    keywords: ['advisory', 'explain', 'candidate order', 'position options', 'authoritative state'],
  }),
  section({
    id: 'mock-bids',
    category: 'Rehearse and operate',
    title: 'Mock Bids',
    route: '/admin/rehearsal',
    routeLabel: 'Mock Bids',
    summary:
      'Mock Bids are isolated rehearsals for validating sequence, selections, amendments, specialty handling, order changes, findings, and operator readiness.',
    controls: [
      'Active Mock Sessions',
      'Findings',
      'Auto Bid',
      'Freeze rehearsal',
      'Reset mock',
      'Close stale mock',
      'Verify audit',
    ],
    steps: [
      'Create or select a mock session.',
      'Use rehearsal controls to run the scenario and record findings.',
      'Freeze, reset, or close the mock using the explicit control when appropriate.',
      'Verify the mock audit before treating the rehearsal as complete.',
    ],
    important:
      'Mock commands remain isolated from canonical staffing and portal writeback. Do not start a real Bid just to test a workflow.',
    keywords: [
      'mock',
      'rehearsal',
      'test bid',
      'freeze mock',
      'reset mock',
      'close mock',
      'auto bid',
      'findings',
    ],
  }),
  section({
    id: 'live-bid',
    category: 'Rehearse and operate',
    title: 'Live Bid',
    route: '/admin/bid',
    routeLabel: 'Live Bid',
    summary:
      'Live Bid is the operator console for an authorized administrator running an actual Bid session. It shows the active bidder, on-deck members, timer, phase, and protected controls.',
    controls: [
      'Current bidder',
      'On deck',
      'Pick for member',
      'Skip',
      'Override',
      'Freeze',
      'Session controls',
    ],
    steps: [
      'Confirm the session, phase, active bidder, and on-deck order.',
      'Only the authorized Admin or operator records a live selection.',
      'Use protected skip, override, or freeze controls only with the required operational reason.',
      'Use session controls for pause or resume where the session state permits.',
    ],
    important:
      'Ordinary members do not make live selections here. Skip, override, and freeze are consequential actions and can require step-up authorization.',
    keywords: [
      'live bid',
      'current bidder',
      'on deck',
      'select position',
      'skip',
      'override',
      'freeze',
      'pause',
      'resume',
      'operator only',
    ],
  }),
  section({
    id: 'specialty-adjudication',
    category: 'Rehearse and operate',
    title: 'Specialty Adjudication',
    route: '/admin/specialty-adjudication',
    routeLabel: 'Specialty Adjudication',
    summary:
      'Specialty Adjudication records a controlled specialty review with the original bidder, eligible higher-priority candidates, points or rank, contacts, outcomes, and exact resumption state.',
    controls: [
      'Specialty review state',
      'Candidate list',
      'Contact attempts',
      'Accept',
      'Decline',
      'Pass',
      'Unreachable',
      'Evidence and reason fields',
    ],
    steps: [
      'Start the specialty review from the live controls when authorized.',
      'Review the original bidder, requested position, candidate order, and policy status.',
      'Record each contact attempt and disposition.',
      'Complete the adjudication and confirm the suspended bidder resumes at the recorded queue state.',
    ],
    important:
      'This area includes synthetic rehearsal support. Keep synthetic and real activity distinct, and do not substitute a synthetic result for live evidence.',
    keywords: [
      'specialty',
      'adjudication',
      'higher priority',
      'points',
      'ranking',
      'contact attempts',
      'accept',
      'decline',
      'unreachable',
      'suspended bidder',
      'resume',
    ],
  }),
  section({
    id: 'live-presentation',
    category: 'Rehearse and operate',
    title: 'Live Presentation',
    route: '/admin/bid',
    routeLabel: 'Live Bid',
    summary:
      'Department presentation controls decide what the presentation shows: OFF, LIVE, HOLD DISPLAY, or RESUME DISPLAY.',
    controls: [
      'OFF',
      'LIVE',
      'HOLD DISPLAY',
      'RESUME DISPLAY',
      'Operator reason',
      'Evidence reference',
    ],
    steps: [
      'Enter the required operator reason and any policy-required evidence reference.',
      'Choose the intended display mode.',
      'Check the command response before continuing operations.',
    ],
    important:
      'HOLD DISPLAY is not the same as pausing Bid execution. Display controls do not pause the live Bid.',
    keywords: [
      'presentation',
      'hold presentation',
      'hold display',
      'resume presentation',
      'live display',
      'off',
    ],
  }),
  section({
    id: 'results-audit',
    category: 'Records and handoff',
    title: 'Results & Audit',
    route: '/admin/audit',
    routeLabel: 'Audit Log',
    summary:
      'Results & Audit helps you review recorded events and the immutable evidence associated with controlled actions.',
    controls: [
      'Event filter',
      'Date filters',
      'Search',
      'Audit results',
      'Exports',
      'Bid Award Transition',
    ],
    steps: [
      'Choose the event and date filters.',
      'Search for the relevant record.',
      'Review the recorded action and supporting context.',
      'Use the related Exports or Award Transition workspace when appropriate.',
    ],
    important:
      'Immutable evidence means the system preserves the recorded operational history; it does not mean every item is automatically approved for downstream action.',
    keywords: ['results', 'audit', 'audit log', 'immutable evidence', 'event filter'],
  }),
  section({
    id: 'exports',
    category: 'Records and handoff',
    title: 'Exports',
    route: '/admin/exports',
    routeLabel: 'Exports',
    summary:
      'Exports provides controlled roster and Bid export generation, direct CSV downloads, available packages, and portal-sync status.',
    controls: [
      'Select a session',
      'Generate',
      'Direct CSV downloads',
      'Available exports',
      'Retry action',
      'Portal sync status',
    ],
    steps: [
      'Select the intended session when the export requires one.',
      'Choose the correct export type or direct CSV download.',
      'Wait for the generated package to appear and verify its scope before distributing it.',
      'Review portal-sync status rather than assuming a write occurred.',
    ],
    important:
      'An export is evidence or a file delivery mechanism; it does not itself authorize a staffing or portal change.',
    keywords: ['export', 'csv', 'roster export', 'bid export', 'download', 'portal sync'],
  }),
  section({
    id: 'award-transition',
    category: 'Records and handoff',
    title: 'Bid Award Transition',
    route: '/admin/award-transition',
    routeLabel: 'Bid Award Transition',
    summary:
      'Bid Award Transition is a fail-closed review workspace for a completed Bid becoming future staffing on a selected effective date.',
    controls: [
      'Completed Bid selection',
      'Assignment comparison',
      'Effective date',
      'Reason',
      'Review acknowledgement',
      'Apply reviewed transition',
    ],
    steps: [
      'Select a completed Bid from its session controls.',
      'Review current-to-new assignments and the effective date.',
      'Record the reviewed reason and acknowledgement.',
      'Apply only when the transition is authorized and the workspace allows it.',
    ],
    important:
      'Portal writeback is currently disabled. Do not represent a reviewed transition as portal writeback or assume external systems were changed.',
    keywords: [
      'award transition',
      'post bid',
      'future staffing',
      'writeback',
      'portal writeback',
      'completed bid',
    ],
  }),
  section({
    id: 'system-integrations',
    category: 'Records and handoff',
    title: 'System & Integrations',
    route: '/admin/system',
    routeLabel: 'System/Integrations',
    summary:
      'System & Integrations presents user-facing health and integration status for Hub federation, TeleStaff, and writeback safety.',
    controls: ['Health and status indicators', 'Integration status'],
    steps: [
      'Review the displayed status before relying on an integration.',
      'Use the related operational workspace for any permitted action.',
      'Treat unavailable or fail-closed status as a stop for the dependent action.',
    ],
    important:
      'A healthy status indicator does not grant permission to deploy, change external systems, or enable writeback.',
    keywords: [
      'system',
      'integration',
      'health',
      'hub federation',
      'telestaff',
      'writeback safety',
    ],
  }),
  section({
    id: 'common-workflows',
    category: 'Help and safety',
    title: 'Common workflows',
    route: '/admin/current-rosters',
    routeLabel: 'Current Rosters',
    summary:
      'Use these short paths to begin common tasks without turning the guide into a single long procedure.',
    controls: ['Open this page links', 'Section navigation', 'Guide search'],
    steps: [
      'Update staffing: Current Rosters → Staffing Structure or Personnel Changes.',
      'Process TeleStaff: TeleStaff → upload → preview → stage → reconcile → review → apply.',
      'Add or promote a member: Personnel Changes → effective date → preview/history → record.',
      'Prepare a Bid: Bid Setup → Rule Books/Positions/Policy → Eligibility Preview → controlled session.',
      'Run a rehearsal: Mock Bids → findings → verify audit.',
      'Export safely: Results & Audit → Exports → verify package scope.',
    ],
    important:
      'For specialty requests, prior-selection amendments, presentation controls, and live operations, use their dedicated guide sections before acting.',
    keywords: [
      'workflow',
      'add employee',
      'promote member',
      'retire member',
      'run mock bid',
      'finish bid safely',
      'export roster',
    ],
  }),
  section({
    id: 'troubleshooting-safety',
    category: 'Help and safety',
    title: 'Troubleshooting & safety',
    route: '/admin/system',
    routeLabel: 'System/Integrations',
    summary:
      'Use the displayed condition and its source workflow to resolve missing records, unavailable actions, policy holds, stale advisory state, and Mock-versus-live confusion safely.',
    controls: ['Status indicators', 'Blocked notices', 'Step-up prompts', 'Guide search'],
    steps: [
      'Member or position missing: verify the effective date and source workflow; do not invent an assignment or seat.',
      'TeleStaff row unknown or incomplete: retain the exception and seek authoritative mapping.',
      'Button unavailable or step-up required: confirm authorization and the required state before retrying.',
      'Policy blocking or unconfigured: complete the approved policy/configuration work.',
      'Advisory sequence behind the board: reload Live Bid and verify the authoritative sequence before acting.',
    ],
    important:
      'Never start a real Bid merely to test it, and never treat Mock Bid behavior as proof of live authorization or a canonical staffing change.',
    keywords: [
      'troubleshooting',
      'member missing',
      'position missing',
      'button unavailable',
      'step up',
      'blocking',
      'unconfigured',
      'stale advisory',
      'mock vs live',
    ],
  }),
  section({
    id: 'glossary',
    category: 'Help and safety',
    title: 'Glossary',
    route: '/admin/guide',
    routeLabel: 'Administrator Guide',
    summary:
      'Plain-language definitions for the terms used across year-round staffing, annual Bid preparation, and live operations.',
    controls: ['Search', 'Category navigation', 'Expandable sections'],
    steps: [
      'Canonical roster: the reviewed operational roster record.',
      'Authorized position: an approved staffing seat; vacancy: an unoccupied authorized seat.',
      'Assignment: a member’s placement; effective date: when a change takes effect.',
      'Reconciliation: review of source information against controlled records; source mapping: an approved connection to source data.',
      'Frozen policy: the preserved policy evidence for an annual Bid; Bid stage: an ordered phase of the process.',
      'Specialty interruption: a controlled pause for specialty review; step-up authentication: an additional confirmation for protected actions.',
      'Mock/rehearsal: isolated practice; live presentation: what the department display shows; audit evidence: the preserved record of an action.',
    ],
    keywords: [
      'glossary',
      'canonical roster',
      'authorized position',
      'vacancy',
      'assignment',
      'effective date',
      'reconciliation',
      'frozen policy',
      'bid stage',
      'step up authentication',
    ],
  }),
];

/** Every Admin navigation destination must be represented in guide content. */
export const ADMIN_GUIDE_COVERAGE: Readonly<Record<string, readonly string[]>> = {
  '/admin': ['getting-started', 'dashboard'],
  '/admin/current-rosters': ['current-rosters', 'common-workflows'],
  '/admin/staffing-structure': ['staffing-structure'],
  '/admin/telestaff': ['telestaff'],
  '/admin/members': ['members', 'credentials'],
  '/admin/personnel': ['personnel', 'qualification-evidence'],
  '/admin/bid-setup': [
    'bid-setup',
    'rule-books',
    'positions-rules',
    'eligibility-preview',
    'bid-pin',
    'annual-policy',
  ],
  '/admin/rehearsal': ['mock-bids'],
  '/admin/bid': ['bid-advisory', 'live-bid', 'specialty-adjudication', 'live-presentation'],
  '/admin/audit': ['results-audit', 'exports', 'award-transition'],
  '/admin/system': ['system-integrations', 'troubleshooting-safety'],
};

export const GUIDE_CATEGORIES = [...new Set(GUIDE_SECTIONS.map((item) => item.category))];

export function filterGuideSections(query: string): readonly GuideSection[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return GUIDE_SECTIONS;

  return GUIDE_SECTIONS.filter((item) => {
    const searchable = [
      item.title,
      item.category,
      item.summary,
      ...item.controls,
      ...item.steps,
      ...item.keywords,
    ]
      .join(' ')
      .toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}
