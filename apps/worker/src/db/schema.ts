import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const members = sqliteTable('members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: text('employee_id').notNull().unique(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  rank: text('rank', { enum: ['FF', 'LT', 'CPT', 'DC', 'DEP_CHIEF', 'CHIEF'] }).notNull(),
  bidCategory: text('bid_category', { enum: ['OFC', 'FF', 'EXCLUDED'] }).notNull(),
  rscSeniority: integer('rsc_seniority').notNull(),
  rankSeniority: integer('rank_seniority'),
  hiredAt: text('hired_at'),
  promotedAt: text('promoted_at'),
  isProbationary: integer('is_probationary', { mode: 'boolean' }).notNull().default(false),
  /** Explicit current projection; legacy records remain intentionally unknown. */
  employmentStatus: text('employment_status', {
    enum: ['unknown', 'active', 'inactive', 'retired', 'separated'],
  })
    .notNull()
    .default('unknown'),
  /** Effective date of the current employment-state projection, when known. */
  employmentStatusEffectiveOn: text('employment_status_effective_on'),
  /** Typed administrative separation/retirement classification where supplied. */
  separationType: text('separation_type'),
  /**
   * Prior-year bid position (e.g. each member's 2025 assignment when running
   * the 2026 bid). Nullable for new hires and members not yet backfilled.
   * Surfaced in /api/board so the Live Bid Console can show "from → to".
   */
  priorPositionId: text('prior_position_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const credentials = sqliteTable('credentials', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  fyPointsDefault: integer('fy_points_default').notNull().default(0),
});

export const memberCredentials = sqliteTable(
  'member_credentials',
  {
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    credentialId: integer('credential_id')
      .notNull()
      .references(() => credentials.id, { onDelete: 'cascade' }),
    startDate: text('start_date'),
    expirationDate: text('expiration_date'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.memberId, t.credentialId] }),
    credIdx: index('member_credentials_credential_id_idx').on(t.credentialId),
  }),
);

export const memberQualificationEvents = sqliteTable(
  'member_qualification_events',
  {
    id: text('id').primaryKey(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    credentialId: integer('credential_id').references(() => credentials.id, {
      onDelete: 'restrict',
    }),
    specialtyCode: text('specialty_code'),
    /**
     * Additive terminal discriminator for specialty evidence. The legacy
     * ledger `kind` remains `SPECIALTY_QUALIFIED` so its immutable CHECK
     * contract and all historic audit rows remain intact.
     */
    specialtyTerminalStatus: text('specialty_terminal_status', {
      enum: ['EXPIRED', 'REVOKED', 'REMOVED'],
    }),
    kind: text('kind', {
      enum: [
        'CERTIFICATION_GAINED',
        'CERTIFICATION_EXPIRED',
        'CERTIFICATION_REVOKED',
        'SPECIALTY_QUALIFIED',
      ],
    }).notNull(),
    effectiveOn: text('effective_on').notNull(),
    expiresOn: text('expires_on'),
    evidenceSource: text('evidence_source').notNull(),
    evidenceReference: text('evidence_reference'),
    reason: text('reason').notNull(),
    actorSubject: text('actor_subject').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    beforeState: text('before_state').notNull(),
    afterState: text('after_state').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    memberEffectiveIdx: index('idx_member_qualification_events_member_effective').on(
      t.memberId,
      t.effectiveOn,
      t.createdAt,
      t.id,
    ),
    credentialEffectiveIdx: index('idx_member_qualification_events_credential_effective').on(
      t.credentialId,
      t.effectiveOn,
      t.createdAt,
      t.id,
    ),
    specialtyEffectiveIdx: index('idx_member_qualification_events_specialty_effective').on(
      t.memberId,
      t.specialtyCode,
      t.effectiveOn,
      t.createdAt,
      t.id,
    ),
  }),
);

export const positionTemplates = sqliteTable('position_templates', {
  version: text('version').primaryKey(),
  effectiveYear: integer('effective_year').notNull(),
  notes: text('notes'),
});

export const positions = sqliteTable(
  'positions',
  {
    id: text('id').notNull(),
    templateVersion: text('template_version')
      .notNull()
      .references(() => positionTemplates.version),
    shift: text('shift', { enum: ['A', 'B', 'C', 'D'] }).notNull(),
    station: text('station').notNull(),
    division: text('division', {
      enum: ['Combat', 'Rescue', 'Prevention', 'Training', 'Support Services'],
    }).notNull(),
    unit: text('unit').notNull(),
    rankRequired: text('rank_required', { enum: ['FF', 'LT', 'CPT', 'DC'] }).notNull(),
    positionName: text('position_name').notNull(),
    isFloating: integer('is_floating', { mode: 'boolean' }).notNull().default(false),
    isVacantByDesign: integer('is_vacant_by_design', { mode: 'boolean' }).notNull().default(false),
    isExcludedFromCount: integer('is_excluded_from_count', { mode: 'boolean' })
      .notNull()
      .default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.id, t.templateVersion] }),
    templateIdx: index('idx_positions_template').on(t.templateVersion),
    shiftStationIdx: index('idx_positions_shift_station').on(t.shift, t.station),
  }),
);

export const ruleBooks = sqliteTable('rule_books', {
  version: text('version').primaryKey(),
  effectiveYear: integer('effective_year').notNull(),
  notes: text('notes'),
  status: text('status', { enum: ['draft', 'active', 'archived'] })
    .notNull()
    .default('draft'),
  publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
  publishedBy: integer('published_by').references(() => members.id, { onDelete: 'set null' }),
  // Increments with every draft rule mutation.  Publication uses this as an
  // optimistic precondition so it cannot promote a rule book that changed
  // after its full-book validation pass.
  revision: integer('revision').notNull().default(0),
});

export const positionRules = sqliteTable(
  'position_rules',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ruleBookVersion: text('rule_book_version')
      .notNull()
      .references(() => ruleBooks.version),
    positionId: text('position_id').notNull(),
    templateVersion: text('template_version').notNull(),
    requiredCriteriaJson: text('required_criteria').notNull(),
    pointsPreferenceJson: text('points_preference').notNull(),
    tieBreakChainJson: text('tie_break_chain').notNull(),
    notes: text('notes'),
  },
  (t) => ({
    ruleBookPositionIdx: index('idx_position_rules_rulebook_position').on(
      t.ruleBookVersion,
      t.positionId,
      t.templateVersion,
    ),
  }),
);

/**
 * Versioned policy override for an annual position inside one rule book.
 * Default participation is BIDDABLE; records exist only when policy explicitly
 * makes a canonical staffing position administratively assigned outside the
 * ordinary Bid. This keeps an active rule book immutable while its clone can
 * carry the approved correction through the normal draft/publish lifecycle.
 */
export const ruleBookPositionParticipation = sqliteTable(
  'rule_book_position_participation',
  {
    ruleBookVersion: text('rule_book_version')
      .notNull()
      .references(() => ruleBooks.version, { onDelete: 'restrict' }),
    positionId: text('position_id').notNull(),
    templateVersion: text('template_version').notNull(),
    bidParticipation: text('bid_participation', {
      enum: ['BIDDABLE', 'ADMIN_ASSIGNED_NON_BIDDABLE', 'RESERVED_NON_BIDDABLE'],
    }).notNull(),
    authoritativeSourceRef: text('authoritative_source_ref').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.ruleBookVersion, t.positionId] }),
    templateIdx: index('idx_rule_book_position_participation_template').on(
      t.ruleBookVersion,
      t.templateVersion,
    ),
    positionTemplateFk: foreignKey({
      columns: [t.positionId, t.templateVersion],
      foreignColumns: [positions.id, positions.templateVersion],
      name: 'rule_book_position_participation_position_template_fkey',
    }).onDelete('restrict'),
  }),
);

// ── Plan 02 Task 4: bid-execution, audit, AI advisory, snapshot, portal ──────

export const bidYears = sqliteTable('bid_years', {
  year: integer('year').primaryKey(),
  status: text('status', {
    enum: ['configuring', 'live', 'paused', 'complete', 'archived'],
  }).notNull(),
  positionTemplateVersion: text('position_template_version').references(
    () => positionTemplates.version,
  ),
  ruleBookVersion: text('rule_book_version').references(() => ruleBooks.version),
  configJson: text('config_json'),
  // Optimistic token for the designated annual configuration source. It is
  // intentionally separate from a draft rule book's own revision.
  configurationRevision: integer('configuration_revision').notNull().default(0),
});

export const bidSessions = sqliteTable('bid_sessions', {
  id: text('id').primaryKey(),
  bidYear: integer('bid_year')
    .notNull()
    .references(() => bidYears.year, { onDelete: 'cascade' }),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  pausedAt: integer('paused_at', { mode: 'timestamp_ms' }),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  currentPhase: text('current_phase', {
    enum: ['config', 'position_bid', 'a_day_bid', 'paused', 'complete'],
  }).notNull(),
  currentBidderId: integer('current_bidder_id').references(() => members.id, {
    onDelete: 'restrict',
  }),
  currentTurnStartedAt: integer('current_turn_started_at', { mode: 'timestamp_ms' }),
  turnTimerSeconds: integer('turn_timer_seconds').notNull().default(180),
  expectedDurationDays: integer('expected_duration_days').notNull().default(2),
  scheduledResumeAt: integer('scheduled_resume_at', { mode: 'timestamp_ms' }),
  dayCount: integer('day_count').notNull().default(0),
  frozenAt: integer('frozen_at', { mode: 'timestamp_ms' }),
  freezeActorId: integer('freeze_actor_id').references(() => members.id, {
    onDelete: 'restrict',
  }),
  freezeReason: text('freeze_reason'),
  configJson: text('config_json'),
  // Plan 09 / Rehearsal Tooling — Task R1.
  // Marks the session as a rehearsal/mock. Portal writeback consumer skips
  // bids belonging to mock sessions; admin dashboard exposes reset/auto-bid.
  isMock: integer('is_mock', { mode: 'boolean' }).notNull().default(false),
  // Optimistic control-plane revision for legacy mock rehearsal mutations.
  // It is distinct from canonical command sequence state.
  mockControlRevision: integer('mock_control_revision').notNull().default(0),
});

/** Frozen decision-support source; command staff still confirms every award. */
export const bidPreferenceSheets = sqliteTable(
  'bid_preference_sheets',
  {
    id: text('id').primaryKey(),
    bidSessionId: text('bid_session_id')
      .notNull()
      .references(() => bidSessions.id, { onDelete: 'restrict' }),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    source: text('source', { enum: ['MEMBER_SUBMISSION', 'OPERATOR_ENTERED'] }).notNull(),
    status: text('status', { enum: ['DRAFT', 'SUBMITTED', 'REVIEWED', 'FROZEN'] }).notNull(),
    submittedAt: integer('submitted_at', { mode: 'timestamp_ms' }).notNull(),
    frozenAt: integer('frozen_at', { mode: 'timestamp_ms' }),
    positionPreferencesJson: text('position_preferences_json').notNull(),
    aDayPreferencesJson: text('a_day_preferences_json').notNull(),
    provenanceReference: text('provenance_reference'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    sessionStatusIdx: index('idx_bid_preference_sheets_session_status').on(
      t.bidSessionId,
      t.status,
      t.memberId,
    ),
  }),
);

export const bidContactAttempts = sqliteTable(
  'bid_contact_attempts',
  {
    id: text('id').primaryKey(),
    bidSessionId: text('bid_session_id')
      .notNull()
      .references(() => bidSessions.id, { onDelete: 'restrict' }),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    attemptNumber: integer('attempt_number').notNull(),
    method: text('method', { enum: ['PHONE', 'TEXT'] }).notNull(),
    operatorMemberId: integer('operator_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    attemptedAt: integer('attempted_at', { mode: 'timestamp_ms' }).notNull(),
    disposition: text('disposition', { enum: ['RECORDED', 'UNREACHABLE'] }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    sessionMemberIdx: index('idx_bid_contact_attempts_session_member').on(
      t.bidSessionId,
      t.memberId,
      t.attemptNumber,
    ),
  }),
);

export const bidSessionCheckpoints = sqliteTable(
  'bid_session_checkpoints',
  {
    id: text('id').primaryKey(),
    bidSessionId: text('bid_session_id')
      .notNull()
      .references(() => bidSessions.id, { onDelete: 'restrict' }),
    commandId: text('command_id').notNull(),
    name: text('name').notNull(),
    actorMemberId: integer('actor_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    sessionSequence: integer('session_sequence').notNull(),
    checkpointJson: text('checkpoint_json').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    sessionSequenceIdx: index('idx_bid_session_checkpoints_session_sequence').on(
      t.bidSessionId,
      t.sessionSequence,
      t.createdAt,
    ),
  }),
);

/**
 * Durable idempotency receipts for the legacy mock rehearsal controls. A row
 * starts pending, then becomes an immutable completed applied response exactly once.
 * Historical no-guess recoveries are immutable sidecar rows so 0035's receipt
 * table never needs an ALTER/rebuild migration.
 */
export const mockRehearsalCommandReceipts = sqliteTable(
  'mock_rehearsal_command_receipts',
  {
    bidSessionId: text('bid_session_id')
      .notNull()
      .references(() => bidSessions.id, { onDelete: 'restrict' }),
    idempotencyKey: text('idempotency_key').notNull(),
    operation: text('operation', { enum: ['auto_bid', 'manual_pick'] }).notNull(),
    actorSubject: text('actor_subject').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    expectedMockControlRevision: integer('expected_mock_control_revision').notNull(),
    state: text('state', { enum: ['pending', 'completed'] }).notNull(),
    responseStatus: integer('response_status'),
    responseJson: text('response_json'),
    resultingMockControlRevision: integer('resulting_mock_control_revision'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.bidSessionId, t.idempotencyKey] }),
    sessionCreatedIdx: index('idx_mock_rehearsal_command_receipts_session_created').on(
      t.bidSessionId,
      t.createdAt,
    ),
  }),
);

export const mockRehearsalCommandRecoveryOutcomes = sqliteTable(
  'mock_rehearsal_command_recovery_outcomes',
  {
    bidSessionId: text('bid_session_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    outcome: text('outcome', { enum: ['not_applied', 'recovery_required'] }).notNull(),
    responseStatus: integer('response_status').notNull(),
    responseJson: text('response_json').notNull(),
    recoveryReason: text('recovery_reason').notNull(),
    recoveredBy: text('recovered_by').notNull(),
    recoveredAt: integer('recovered_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.bidSessionId, t.idempotencyKey] }),
    recoveredIdx: index('idx_mock_rehearsal_command_recovery_outcomes_recovered_at').on(
      t.bidSessionId,
      t.recoveredAt,
    ),
  }),
);

export const bidOrder = sqliteTable(
  'bid_order',
  {
    bidSessionId: text('bid_session_id')
      .notNull()
      .references(() => bidSessions.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    pool: text('pool', { enum: ['OFC', 'FF'] }).notNull(),
    /** Null only for historical two-pool sessions predating frozen live stages. */
    stageId: text('stage_id'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.bidSessionId, t.ordinal] }),
    memberIdx: index('idx_bid_order_member_id').on(t.memberId),
  }),
);

export const bids = sqliteTable(
  'bids',
  {
    id: text('id').primaryKey(),
    bidSessionId: text('bid_session_id')
      .notNull()
      .references(() => bidSessions.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    // No FK to positions — composite PK on positions blocks single-column FK
    positionId: text('position_id').notNull(),
    aDay: text('a_day'),
    pickedAt: integer('picked_at', { mode: 'timestamp' }).notNull(),
    forced: integer('forced', { mode: 'boolean' }).notNull().default(false),
    adminActorId: integer('admin_actor_id').references(() => members.id, {
      onDelete: 'restrict',
    }),
    reason: text('reason'),
    idempotencyKey: text('idempotency_key').unique().notNull(),
    portalSyncStatus: text('portal_sync_status', {
      enum: ['pending', 'synced', 'failed', 'superseded'],
    })
      .notNull()
      .default('pending'),
    portalSyncedAt: integer('portal_synced_at', { mode: 'timestamp' }),
    portalSyncAttempts: integer('portal_sync_attempts').notNull().default(0),
    portalLastError: text('portal_last_error'),
  },
  (t) => ({
    sessionOrdinalIdx: index('idx_bids_session_ordinal').on(t.bidSessionId, t.ordinal),
    memberIdx: index('idx_bids_member_id').on(t.memberId),
    portalSyncStatusIdx: index('idx_bids_portal_sync_status').on(t.portalSyncStatus),
  }),
);

export const portalWritebackQueue = sqliteTable(
  'portal_writeback_queue',
  {
    id: text('id').primaryKey(),
    bidId: text('bid_id')
      .notNull()
      .references(() => bids.id, { onDelete: 'cascade' }),
    enqueuedAt: integer('enqueued_at', { mode: 'timestamp' }).notNull(),
    nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp' }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    status: text('status', {
      enum: ['queued', 'in_flight', 'done', 'failed'],
    }).notNull(),
    payloadJson: text('payload_json').notNull(),
    lastError: text('last_error'),
  },
  (t) => ({
    statusNextAttemptIdx: index('idx_portal_writeback_queue_status_next').on(
      t.status,
      t.nextAttemptAt,
    ),
  }),
);

/** Immutable link from an original award to its one permitted replacement. */
export const bidAwardAmendments = sqliteTable('bid_award_amendments', {
  id: text('id').primaryKey().notNull(),
  bidSessionId: text('bid_session_id')
    .notNull()
    .references(() => bidSessions.id, { onDelete: 'restrict' }),
  originalBidId: text('original_bid_id')
    .notNull()
    .references(() => bids.id, { onDelete: 'restrict' }),
  replacementBidId: text('replacement_bid_id')
    .notNull()
    .references(() => bids.id, { onDelete: 'restrict' }),
  actorMemberId: integer('actor_member_id').references(() => members.id, { onDelete: 'restrict' }),
  expectedSessionRevision: integer('expected_session_revision').notNull(),
  reason: text('reason').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    bidSessionId: text('bid_session_id').references(() => bidSessions.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    actorType: text('actor_type', {
      enum: ['member', 'admin', 'system', 'ai'],
    }).notNull(),
    actorId: integer('actor_id'),
    action: text('action', {
      enum: [
        'pick',
        'forced_pick',
        'pause',
        'resume',
        'skip',
        'override_rule',
        'override_cert',
        'lock_position',
        'unlock_position',
        'grant_extension',
        'admin_bid_for_member',
        'amend_selection',
        'session_start',
        'mark_mock',
        'mock_session_closed',
        'session_complete',
        'members_import',
        'credentials_import',
        'credential_create',
        'credential_update',
        'positions_clone',
        'rule_book_clone',
        'bid_configuration_set',
        'bid_award_transition',
        'telestaff_apply',
        'qualification_lifecycle',
        'dissent',
        'a_day_pick',
        'forced_a_day_pick',
        'portal_writeback_retry',
        'portal_writeback_clear',
        'rehearsal_finding',
        'export_generate',
        'setting_change',
        'portal_writeback_attempt',
        'portal_writeback_outcome',
      ],
    }).notNull(),
    targetKind: text('target_kind'),
    targetId: text('target_id'),
    beforeState: text('before_state'),
    afterState: text('after_state'),
    reason: text('reason'),
    aiAdvisoryId: text('ai_advisory_id'),
    clientMeta: text('client_meta'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    // Plan 08 — back-references into the R2 audit chain (mig 0013).
    chunkSeq: integer('chunk_seq'),
    chunkRowIndex: integer('chunk_row_index'),
  },
  (t) => ({
    sessionSeqIdx: index('audit_log_session_seq_idx').on(t.bidSessionId, t.seq),
  }),
);

// ── Canonical command/audit/outbox (migration 0022) ────────────────────────
//
// Commands are serialized by their named Durable Object, but D1 is the
// durable authority. The state row, receipt, immutable event, audit row, and
// R2 archive work item are committed in one D1 batch. The outbox's delivery
// fields are mutable; its event payload is not.
export const canonicalBidSessionState = sqliteTable('canonical_bid_session_state', {
  bidSessionId: text('bid_session_id')
    .primaryKey()
    .references(() => bidSessions.id, { onDelete: 'restrict' }),
  currentSeq: integer('current_seq').notNull(),
  stateJson: text('state_json').notNull(),
  lastCommandId: text('last_command_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const bidCommandReceipts = sqliteTable(
  'bid_command_receipts',
  {
    commandId: text('command_id').primaryKey(),
    bidSessionId: text('bid_session_id')
      .notNull()
      .references(() => bidSessions.id, { onDelete: 'restrict' }),
    commandType: text('command_type').notNull(),
    requestSha256: text('request_sha256').notNull(),
    actorId: integer('actor_id').notNull(),
    expectedSeq: integer('expected_seq').notNull(),
    resultSeq: integer('result_seq'),
    outcome: text('outcome', { enum: ['accepted', 'rejected'] }).notNull(),
    resultJson: text('result_json').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    sessionCreatedIdx: index('idx_bid_command_receipts_session_created').on(
      t.bidSessionId,
      t.createdAt,
    ),
  }),
);

export const bidCommandEvents = sqliteTable(
  'bid_command_events',
  {
    id: text('id').primaryKey(),
    bidSessionId: text('bid_session_id')
      .notNull()
      .references(() => bidSessions.id, { onDelete: 'restrict' }),
    commandId: text('command_id')
      .notNull()
      .references(() => bidCommandReceipts.commandId, { onDelete: 'restrict' }),
    auditLogId: text('audit_log_id')
      .notNull()
      .references(() => auditLog.id, { onDelete: 'restrict' }),
    seq: integer('seq').notNull(),
    eventType: text('event_type').notNull(),
    eventJson: text('event_json').notNull(),
    actorId: integer('actor_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    commandUnique: uniqueIndex('bid_command_events_command_id_unique').on(t.commandId),
    auditUnique: uniqueIndex('bid_command_events_audit_log_id_unique').on(t.auditLogId),
    sessionSeqUnique: uniqueIndex('bid_command_events_session_seq_unique').on(
      t.bidSessionId,
      t.seq,
    ),
    sessionCreatedIdx: index('idx_bid_command_events_session_created').on(
      t.bidSessionId,
      t.createdAt,
    ),
  }),
);

export const bidAuditOutbox = sqliteTable(
  'bid_audit_outbox',
  {
    id: text('id').primaryKey(),
    bidSessionId: text('bid_session_id')
      .notNull()
      .references(() => bidSessions.id, { onDelete: 'restrict' }),
    commandId: text('command_id')
      .notNull()
      .references(() => bidCommandReceipts.commandId, { onDelete: 'restrict' }),
    eventId: text('event_id')
      .notNull()
      .references(() => bidCommandEvents.id, { onDelete: 'restrict' }),
    archiveKey: text('archive_key').notNull(),
    payloadJson: text('payload_json').notNull(),
    payloadSha256: text('payload_sha256').notNull(),
    status: text('status', {
      enum: ['pending', 'leased', 'retry', 'archived', 'dead_letter'],
    })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp_ms' }).notNull(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp_ms' }),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    lastError: text('last_error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    eventUnique: uniqueIndex('bid_audit_outbox_event_id_unique').on(t.eventId),
    archiveKeyUnique: uniqueIndex('bid_audit_outbox_archive_key_unique').on(t.archiveKey),
    dueIdx: index('idx_bid_audit_outbox_due').on(t.status, t.nextAttemptAt),
  }),
);

export const bidSessionSnapshots = sqliteTable(
  'bid_session_snapshots',
  {
    bidSessionId: text('bid_session_id')
      .notNull()
      .references(() => bidSessions.id, { onDelete: 'cascade' }),
    snapshotAt: integer('snapshot_at', { mode: 'timestamp' }).notNull(),
    stateJson: text('state_json').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.bidSessionId, t.snapshotAt] }),
    sessionSnapshotIdx: index('idx_bid_session_snapshots_session_at').on(
      t.bidSessionId,
      t.snapshotAt,
    ),
  }),
);

/**
 * Immutable normalized input used to derive a session's ordinary Bid pool.
 * It binds the session to one archived-or-active rule book and template so a
 * later staffing update cannot silently alter the pool mid-session.
 */
export const bidSessionPolicySnapshots = sqliteTable(
  'bid_session_policy_snapshots',
  {
    bidSessionId: text('bid_session_id')
      .primaryKey()
      .references(() => bidSessions.id, { onDelete: 'cascade' }),
    ruleBookVersion: text('rule_book_version')
      .notNull()
      .references(() => ruleBooks.version, { onDelete: 'restrict' }),
    positionTemplateVersion: text('position_template_version')
      .notNull()
      .references(() => positionTemplates.version, { onDelete: 'restrict' }),
    // Null only for immutable pre-0025 V1 recovery records. Fresh V3
    // snapshots carry the exact source revision alongside immutable material.
    ruleBookRevision: integer('rule_book_revision'),
    snapshotJson: text('snapshot_json').notNull(),
    capturedAt: integer('captured_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    ruleBookIdx: index('idx_bid_session_policy_snapshots_rule_book').on(t.ruleBookVersion),
  }),
);

// Plan 07: Phase 2 A-Day picks
export const aDayPicks = sqliteTable(
  'a_day_picks',
  {
    id: text('id').primaryKey().notNull(),
    bidSessionId: text('bid_session_id')
      .notNull()
      .references(() => bidSessions.id, { onDelete: 'cascade' }),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    shift: text('shift', { enum: ['A', 'B', 'C', 'D'] }).notNull(),
    aDay: text('a_day').notNull(), // 'G1'..'G4' | 'MON'..'SUN'
    pickedAtMs: integer('picked_at').notNull(),
    forced: integer('forced', { mode: 'boolean' }).default(false).notNull(),
    adminActorId: integer('admin_actor_id').references(() => members.id, {
      onDelete: 'restrict',
    }),
    reason: text('reason'),
    idempotencyKey: text('idempotency_key').notNull(),
  },
  (t) => ({
    sessionMemberUnique: uniqueIndex('a_day_picks_session_member_unique').on(
      t.bidSessionId,
      t.memberId,
    ),
    idempotencyUnique: uniqueIndex('a_day_picks_idempotency_key_unique').on(t.idempotencyKey),
    sessionShiftAday: index('idx_a_day_picks_session_shift_aday').on(
      t.bidSessionId,
      t.shift,
      t.aDay,
    ),
    memberIdx: index('idx_a_day_picks_member').on(t.memberId),
  }),
);

// ── Plan 08 — Audit chain bookkeeping (mig 0013) ────────────────────────────
//
// `audit_chunks` indexes every JSONL chunk flushed to R2 so the verifier can
// stream chunks back in deterministic seq order without scanning R2 listings.
// `audit_chain_state` tracks per-session pointer state (next seq, current
// buffer-started-at for the 30-second timeout, and last chunk hash so the next
// chunk can be linked without a round-trip read).
export const auditChunks = sqliteTable(
  'audit_chunks',
  {
    bidSessionId: text('bid_session_id')
      .notNull()
      .references(() => bidSessions.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    r2Key: text('r2_key').notNull(),
    sha256: text('sha256').notNull(),
    prevSha256: text('prev_sha256'),
    signatureB64u: text('signature_b64u').notNull(),
    pubkeyB64u: text('pubkey_b64u').notNull(),
    eventsInChunk: integer('events_in_chunk').notNull(),
    minSeq: integer('min_seq').notNull(),
    maxSeq: integer('max_seq').notNull(),
    signedAt: integer('signed_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.bidSessionId, t.seq] }),
    sessionSeqIdx: index('idx_audit_chunks_session_seq').on(t.bidSessionId, t.seq),
  }),
);

export const auditChainState = sqliteTable('audit_chain_state', {
  bidSessionId: text('bid_session_id')
    .primaryKey()
    .references(() => bidSessions.id, { onDelete: 'cascade' }),
  nextSeq: integer('next_seq').notNull().default(1),
  pendingBufferStartedAt: integer('pending_buffer_started_at', { mode: 'timestamp' }),
  lastChunkSha256: text('last_chunk_sha256'),
});

// ── Members section / Master Roster — mig 0016 ──────────────────────────────
//
// Per-session manual override that re-positions a member in the computed
// bid queue. The natural order is computed from `members` (bidCategory +
// rscSeniority + rankSeniority). Rows in this table replace the ordinal a
// particular member would otherwise occupy for one specific bid session.
export const manualBidOrderOverride = sqliteTable(
  'manual_bid_order_override',
  {
    bidSessionId: text('bid_session_id')
      .notNull()
      .references(() => bidSessions.id, { onDelete: 'cascade' }),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    overrideOrdinal: integer('override_ordinal').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.bidSessionId, t.memberId] }),
    ordinalIdx: index('idx_mbo_ordinal').on(t.bidSessionId, t.overrideOrdinal),
  }),
);

// ── Plan 09 / Rehearsal Tooling — mig 0015 ──────────────────────────────────
//
// In-app bug tracker for mock-draft rehearsals. Each row is one observation
// a participant captures during a rehearsal session. The screenshot (if any)
// lives in R2; only the key is stored here.
export const rehearsalFindings = sqliteTable(
  'rehearsal_findings',
  {
    id: text('id').primaryKey().notNull(),
    bidSessionId: text('bid_session_id')
      .notNull()
      .references(() => bidSessions.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    authorId: integer('author_id').references(() => members.id, { onDelete: 'set null' }),
    note: text('note').notNull(),
    screenshotR2Key: text('screenshot_r2_key'),
  },
  (t) => ({
    sessionCreatedAtIdx: index('idx_rehearsal_findings_session').on(t.bidSessionId, t.createdAt),
  }),
);

// ── Bid V2 canonical staffing/import foundation — migration 0021 ────────────
//
// The source model deliberately separates MBFD-owned authorized slots from
// source-system mappings, immutable observations, and effective-dated
// authoritative assignments. Import rows contain only opaque references and
// normalized topology, never raw TeleStaff/personnel material.
export const staffingPositions = sqliteTable(
  'staffing_positions',
  {
    id: text('id').primaryKey().notNull(),
    stableSlotKey: text('stable_slot_key').notNull(),
    division: text('division'),
    shift: text('shift'),
    station: text('station'),
    unit: text('unit'),
    positionName: text('position_name'),
    applicableRank: text('applicable_rank'),
    activeFrom: text('active_from'),
    activeTo: text('active_to'),
    reviewStatus: text('review_status', { enum: ['draft', 'approved', 'retired'] })
      .notNull()
      .default('draft'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    stableSlotKeyUnique: uniqueIndex('staffing_positions_stable_slot_key_unique').on(
      t.stableSlotKey,
    ),
    reviewStatusIdx: index('idx_staffing_positions_review_status').on(t.reviewStatus),
  }),
);

/**
 * Explicit bridge from the annual Bid template to an approved canonical
 * staffing slot. The bridge is required before an administrative assignment
 * can alter Bid-pool membership; IDs are never assumed to be equivalent.
 */
export const positionStaffingBindings = sqliteTable(
  'position_staffing_bindings',
  {
    positionId: text('position_id').notNull(),
    templateVersion: text('template_version').notNull(),
    staffingPositionId: text('staffing_position_id')
      .notNull()
      .references(() => staffingPositions.id, { onDelete: 'restrict' }),
    authoritativeSourceRef: text('authoritative_source_ref').notNull(),
    reviewStatus: text('review_status', { enum: ['draft', 'approved', 'retired'] })
      .notNull()
      .default('draft'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.positionId, t.templateVersion] }),
    staffingTemplateUnique: uniqueIndex('position_staffing_bindings_staffing_template_unique').on(
      t.staffingPositionId,
      t.templateVersion,
    ),
    reviewStatusIdx: index('idx_position_staffing_bindings_review_status').on(t.reviewStatus),
    positionTemplateFk: foreignKey({
      columns: [t.positionId, t.templateVersion],
      foreignColumns: [positions.id, positions.templateVersion],
      name: 'position_staffing_bindings_position_template_fkey',
    }).onDelete('restrict'),
  }),
);

export const staffingPositionSourceMappings = sqliteTable(
  'staffing_position_source_mappings',
  {
    id: text('id').primaryKey().notNull(),
    staffingPositionId: text('staffing_position_id')
      .notNull()
      .references(() => staffingPositions.id, { onDelete: 'restrict' }),
    sourceSystem: text('source_system').notNull(),
    sourceLocator: text('source_locator').notNull(),
    /** Reviewer-controlled stable seat discriminator for repeated topology. */
    sourceDiscriminator: text('source_discriminator').notNull().default('primary'),
    sourceSignature: text('source_signature').notNull(),
    sourceVersion: text('source_version').notNull(),
    sourceHash: text('source_hash').notNull(),
    effectiveFrom: text('effective_from').notNull(),
    effectiveTo: text('effective_to'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    locatorUnique: uniqueIndex('staffing_position_source_mapping_locator_unique').on(
      t.sourceSystem,
      t.sourceLocator,
      t.sourceDiscriminator,
      t.effectiveFrom,
    ),
    slotEffectiveIdx: index('idx_staffing_position_source_mappings_slot_effective').on(
      t.staffingPositionId,
      t.effectiveFrom,
    ),
    idPositionUnique: uniqueIndex('staffing_position_source_mappings_id_position_unique').on(
      t.id,
      t.staffingPositionId,
    ),
  }),
);

export const assignmentImports = sqliteTable(
  'assignment_imports',
  {
    id: text('id').primaryKey().notNull(),
    sourceSystem: text('source_system').notNull(),
    sourceVersion: text('source_version').notNull(),
    sourceHash: text('source_hash').notNull(),
    /** Versioned source adapter identity; legacy imports remain nullable. */
    sourceFormat: text('source_format'),
    /** Immutable parser implementation version for baseline-capable imports. */
    parserVersion: text('parser_version'),
    /**
     * Operational source scope. Only an authorized `official` source can be
     * designated for a real Bid-year baseline; fixtures stay `synthetic_test`.
     */
    sourceKind: text('source_kind', {
      enum: ['official', 'synthetic_test', 'legacy_unclassified'],
    })
      .notNull()
      .default('legacy_unclassified'),
    status: text('status', {
      enum: ['staged', 'reviewed', 'approved', 'committed', 'rejected'],
    })
      .notNull()
      .default('staged'),
    inputRowCount: integer('input_row_count').notNull().default(0),
    /** Number of semantic data rows after structural blank rows are excluded. */
    normalizedDataRowCount: integer('normalized_data_row_count'),
    /** Count of distinct opaque source employee references in the manifest. */
    uniqueEmployeeCount: integer('unique_employee_count'),
    /** All report rows after the semantic header, including structural blanks. */
    reportRowCount: integer('report_row_count').notNull().default(0),
    /** Wholly blank report rows excluded from source-row accounting. */
    structuralRowCount: integer('structural_row_count').notNull().default(0),
    /** Explicit source observation date if supplied; never an inferred import date. */
    sourceSnapshotAsOf: text('source_snapshot_as_of'),
    /** Exact source time only when metadata or an operator confirmation supports it. */
    sourceObservedAt: integer('source_observed_at', { mode: 'timestamp_ms' }),
    sourceObservationTimeBasis: text('source_observation_time_basis', {
      enum: ['date_only', 'source_metadata', 'administrator_confirmed'],
    })
      .notNull()
      .default('date_only'),
    // Optimistic-concurrency token for the TeleStaff reconciliation review surface.
    reconciliationRevision: integer('reconciliation_revision').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
    approvedByMemberId: integer('approved_by_member_id').references(() => members.id, {
      onDelete: 'restrict',
    }),
    committedAt: integer('committed_at', { mode: 'timestamp_ms' }),
  },
  (t) => ({
    statusCreatedIdx: index('idx_assignment_imports_status_created').on(t.status, t.createdAt),
  }),
);

/**
 * Immutable annual designation of the one accepted TeleStaff manifest. This
 * prevents an arbitrary historic or synthetic import from qualifying a Bid
 * year. A newer source supersedes through a new ledger row, never by editing
 * source evidence.
 */
export const bidYearStaffingBaselines = sqliteTable(
  'bid_year_staffing_baselines',
  {
    id: text('id').primaryKey().notNull(),
    bidYear: integer('bid_year')
      .notNull()
      .references(() => bidYears.year, { onDelete: 'restrict' }),
    assignmentImportId: text('assignment_import_id')
      .notNull()
      .references(() => assignmentImports.id, { onDelete: 'restrict' }),
    status: text('status', { enum: ['accepted', 'superseded'] }).notNull(),
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }).notNull(),
    acceptedByMemberId: integer('accepted_by_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    acceptanceReason: text('acceptance_reason').notNull(),
    supersededAt: integer('superseded_at', { mode: 'timestamp_ms' }),
    supersededByMemberId: integer('superseded_by_member_id').references(() => members.id, {
      onDelete: 'restrict',
    }),
    supersessionReason: text('supersession_reason'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    acceptedBidYearUnique: uniqueIndex('bid_year_staffing_baselines_one_accepted_per_year')
      .on(t.bidYear)
      .where(sql`${t.status} = 'accepted'`),
    assignmentImportUnique: uniqueIndex('bid_year_staffing_baselines_one_year_per_import').on(
      t.assignmentImportId,
    ),
    importStatusIdx: index('idx_bid_year_staffing_baselines_import').on(
      t.assignmentImportId,
      t.status,
    ),
  }),
);

export const assignmentImportRows = sqliteTable(
  'assignment_import_rows',
  {
    id: text('id').primaryKey().notNull(),
    importId: text('import_id')
      .notNull()
      .references(() => assignmentImports.id, { onDelete: 'cascade' }),
    sourceRowNumber: integer('source_row_number').notNull(),
    /** HMAC-SHA-256 source-row provenance; never a plain personnel-derived hash. */
    rowFingerprint: text('row_fingerprint').notNull(),
    // HMAC-SHA-256 reference; never a plain hash of a personnel identifier.
    memberReferenceHmac: text('member_reference_hmac'),
    resolvedMemberId: integer('resolved_member_id').references(() => members.id, {
      onDelete: 'restrict',
    }),
    staffingPositionSourceMappingId: text('staffing_position_source_mapping_id').references(
      () => staffingPositionSourceMappings.id,
      { onDelete: 'restrict' },
    ),
    // Source-system A/R-day notation, deliberately distinct from Bid A-Day.
    sourceARDay: text('source_a_r_day'),
    normalizedSourceTopology: text('normalized_source_topology').notNull(),
    /** Incomplete source topology remains reviewed source evidence only. */
    sourceTopologyCompleteness: text('source_topology_completeness', {
      enum: ['complete', 'incomplete'],
    })
      .notNull()
      .default('complete'),
    disposition: text('disposition', {
      enum: [
        'unchanged',
        'moved',
        'new_combination',
        'missing_vanished',
        'unknown_employee',
        'ambiguous_mapping',
      ],
    })
      .notNull()
      .default('ambiguous_mapping'),
    // Nullable for pre-v2 history. New imports record an explicit operator taxonomy.
    reconciliationClassification: text('reconciliation_classification', {
      enum: [
        'UNCHANGED',
        'MOVED',
        'NEW_ASSIGNMENT',
        'NEW_POSITION',
        'MISSING_OBSERVATION',
        'UNKNOWN_EMPLOYEE',
        'AMBIGUOUS_MAPPING',
        'INCOMPLETE_TOPOLOGY',
      ],
    }),
    reviewStatus: text('review_status', {
      enum: ['not_required', 'pending', 'approved', 'rejected'],
    })
      .notNull()
      .default('pending'),
    resolutionAction: text('resolution_action', {
      enum: [
        'APPLY_OBSERVATION',
        'DEFER_NEW_POSITION',
        'REJECT_SOURCE_ROW',
        'RETAIN_ASSIGNMENT',
        'END_ASSIGNMENT',
        'RETAIN_UNMATERIALIZED_SOURCE_ROW',
      ],
    }),
    reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }),
    reviewedByMemberId: integer('reviewed_by_member_id').references(() => members.id, {
      onDelete: 'restrict',
    }),
    resolutionReason: text('resolution_reason'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    importRowUnique: uniqueIndex('assignment_import_rows_import_row_unique').on(
      t.importId,
      t.sourceRowNumber,
    ),
    importFingerprintUnique: uniqueIndex('assignment_import_rows_import_fingerprint_unique').on(
      t.importId,
      t.rowFingerprint,
    ),
    importMemberReferenceHmacUnique: uniqueIndex(
      'assignment_import_rows_import_member_reference_hmac_unique',
    )
      .on(t.importId, t.memberReferenceHmac)
      .where(sql`${t.memberReferenceHmac} is not null`),
    importDispositionIdx: index('idx_assignment_import_rows_disposition').on(
      t.importId,
      t.disposition,
      t.reviewStatus,
    ),
    reconciliationIdx: index('idx_assignment_import_rows_v2_reconciliation').on(
      t.importId,
      t.reconciliationClassification,
      t.reviewStatus,
    ),
    idImportUnique: uniqueIndex('assignment_import_rows_id_import_unique').on(t.id, t.importId),
    idMemberUnique: uniqueIndex('assignment_import_rows_id_member_unique').on(
      t.id,
      t.resolvedMemberId,
    ),
    idMappingUnique: uniqueIndex('assignment_import_rows_id_mapping_unique').on(
      t.id,
      t.staffingPositionSourceMappingId,
    ),
  }),
);

export const assignmentObservations = sqliteTable(
  'assignment_observations',
  {
    id: text('id').primaryKey().notNull(),
    assignmentImportId: text('assignment_import_id')
      .notNull()
      .references(() => assignmentImports.id, { onDelete: 'restrict' }),
    assignmentImportRowId: text('assignment_import_row_id').notNull(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    staffingPositionId: text('staffing_position_id')
      .notNull()
      .references(() => staffingPositions.id, { onDelete: 'restrict' }),
    staffingPositionSourceMappingId: text('staffing_position_source_mapping_id').notNull(),
    sourceARDay: text('source_a_r_day'),
    normalizedSourceTopology: text('normalized_source_topology').notNull(),
    /** Import/application record time retained for existing audit continuity. */
    observedAt: integer('observed_at', { mode: 'timestamp_ms' }).notNull(),
    /** Source-observation timestamp; null deliberately represents date-only source evidence. */
    sourceObservedAt: integer('source_observed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    importRowUnique: uniqueIndex('assignment_observations_import_row_unique').on(
      t.assignmentImportRowId,
    ),
    memberObservedIdx: index('idx_assignment_observations_member_observed').on(
      t.memberId,
      t.observedAt,
    ),
    positionObservedIdx: index('idx_assignment_observations_position_observed').on(
      t.staffingPositionId,
      t.observedAt,
    ),
    importRowImportFk: foreignKey({
      columns: [t.assignmentImportRowId, t.assignmentImportId],
      foreignColumns: [assignmentImportRows.id, assignmentImportRows.importId],
      name: 'assignment_observations_import_row_import_fkey',
    }).onDelete('restrict'),
    importRowMemberFk: foreignKey({
      columns: [t.assignmentImportRowId, t.memberId],
      foreignColumns: [assignmentImportRows.id, assignmentImportRows.resolvedMemberId],
      name: 'assignment_observations_import_row_member_fkey',
    }).onDelete('restrict'),
    importRowMappingFk: foreignKey({
      columns: [t.assignmentImportRowId, t.staffingPositionSourceMappingId],
      foreignColumns: [
        assignmentImportRows.id,
        assignmentImportRows.staffingPositionSourceMappingId,
      ],
      name: 'assignment_observations_import_row_mapping_fkey',
    }).onDelete('restrict'),
    mappingPositionFk: foreignKey({
      columns: [t.staffingPositionSourceMappingId, t.staffingPositionId],
      foreignColumns: [
        staffingPositionSourceMappings.id,
        staffingPositionSourceMappings.staffingPositionId,
      ],
      name: 'assignment_observations_mapping_position_fkey',
    }).onDelete('restrict'),
  }),
);

export const memberAssignments = sqliteTable(
  'member_assignments',
  {
    id: text('id').primaryKey().notNull(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    staffingPositionId: text('staffing_position_id')
      .notNull()
      .references(() => staffingPositions.id, { onDelete: 'restrict' }),
    originType: text('origin_type', {
      enum: [
        'TELESTAFF_IMPORT',
        'BID_AWARD',
        'MID_CYCLE_VACANCY',
        'ADMIN_TRANSFER',
        'PROMOTION',
        'CORRECTION',
      ],
    }).notNull(),
    originRef: text('origin_ref').notNull(),
    sourceObservationId: text('source_observation_id').references(() => assignmentObservations.id, {
      onDelete: 'restrict',
    }),
    status: text('status', {
      enum: ['planned', 'active', 'superseded', 'cancelled', 'ended'],
    })
      .notNull()
      .default('planned'),
    effectiveFrom: text('effective_from').notNull(),
    effectiveTo: text('effective_to'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    memberEffectiveIdx: index('idx_member_assignments_member_effective').on(
      t.memberId,
      t.effectiveFrom,
    ),
    positionEffectiveIdx: index('idx_member_assignments_position_effective').on(
      t.staffingPositionId,
      t.effectiveFrom,
    ),
    sourceObservationUnique: uniqueIndex('member_assignments_source_observation_unique').on(
      t.sourceObservationId,
    ),
  }),
);

/**
 * Append-only administrative lifecycle evidence.  This is deliberately not a
 * second member or assignment model: `members` remains identity/current state,
 * while `member_assignments` remains effective-dated placement history.
 */
export const personnelLifecycleEvents = sqliteTable(
  'personnel_lifecycle_events',
  {
    id: text('id').primaryKey().notNull(),
    memberId: integer('member_id').references(() => members.id, { onDelete: 'restrict' }),
    staffingPositionId: text('staffing_position_id').references(() => staffingPositions.id, {
      onDelete: 'restrict',
    }),
    memberAssignmentId: text('member_assignment_id').references(() => memberAssignments.id, {
      onDelete: 'restrict',
    }),
    kind: text('kind', {
      enum: [
        'NEW_HIRE',
        'REACTIVATION',
        'PROMOTION',
        'DEMOTION',
        'TRANSFER',
        'ADMIN_REASSIGNMENT',
        'RETIREMENT',
        'SEPARATION',
        'VACATE',
        'POSITION_CREATE',
        'POSITION_RETIRE',
        'CORRECTION',
      ],
    }).notNull(),
    effectiveOn: text('effective_on').notNull(),
    employmentStatusBefore: text('employment_status_before', {
      enum: ['unknown', 'active', 'inactive', 'retired', 'separated'],
    }),
    employmentStatusAfter: text('employment_status_after', {
      enum: ['unknown', 'active', 'inactive', 'retired', 'separated'],
    }),
    rankBefore: text('rank_before', { enum: ['FF', 'LT', 'CPT', 'DC', 'DEP_CHIEF', 'CHIEF'] }),
    rankAfter: text('rank_after', { enum: ['FF', 'LT', 'CPT', 'DC', 'DEP_CHIEF', 'CHIEF'] }),
    separationType: text('separation_type'),
    reason: text('reason').notNull(),
    origin: text('origin', { enum: ['ADMIN', 'SYSTEM', 'BID', 'TELESTAFF'] }).notNull(),
    actorSubject: text('actor_subject').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    beforeState: text('before_state').notNull(),
    afterState: text('after_state').notNull(),
    supersedesEventId: text('supersedes_event_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    idempotencyUnique: uniqueIndex('personnel_lifecycle_events_idempotency_key_unique').on(
      t.idempotencyKey,
    ),
    memberEffectiveIdx: index('idx_personnel_lifecycle_events_member_effective').on(
      t.memberId,
      t.effectiveOn,
      t.createdAt,
    ),
    positionEffectiveIdx: index('idx_personnel_lifecycle_events_position_effective').on(
      t.staffingPositionId,
      t.effectiveOn,
      t.createdAt,
    ),
    assignmentIdx: index('idx_personnel_lifecycle_events_assignment').on(
      t.memberAssignmentId,
      t.effectiveOn,
      t.createdAt,
    ),
    supersedesEventFk: foreignKey({
      columns: [t.supersedesEventId],
      foreignColumns: [t.id],
      name: 'personnel_lifecycle_events_supersedes_event_fkey',
    }).onDelete('restrict'),
  }),
);

/**
 * Negative source evidence is separate from assignment_import_rows so it never
 * inflates the source manifest's input-row count. A resolved finding records a
 * review decision; it does not delete capacity by itself.
 */
export const assignmentImportMissingObservations = sqliteTable(
  'assignment_import_missing_observations',
  {
    id: text('id').primaryKey().notNull(),
    importId: text('import_id')
      .notNull()
      .references(() => assignmentImports.id, { onDelete: 'restrict' }),
    memberAssignmentId: text('member_assignment_id')
      .notNull()
      .references(() => memberAssignments.id, { onDelete: 'restrict' }),
    classification: text('classification', { enum: ['MISSING_OBSERVATION'] })
      .notNull()
      .default('MISSING_OBSERVATION'),
    reviewStatus: text('review_status', { enum: ['pending', 'resolved'] })
      .notNull()
      .default('pending'),
    resolutionAction: text('resolution_action', {
      enum: ['RETAIN_ASSIGNMENT', 'END_ASSIGNMENT'],
    }),
    reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }),
    reviewedByMemberId: integer('reviewed_by_member_id').references(() => members.id, {
      onDelete: 'restrict',
    }),
    resolutionReason: text('resolution_reason'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    importAssignmentUnique: uniqueIndex(
      'assignment_import_missing_observations_import_assignment_unique',
    ).on(t.importId, t.memberAssignmentId),
    importReviewIdx: index('idx_assignment_import_missing_observations_review').on(
      t.importId,
      t.reviewStatus,
    ),
  }),
);
