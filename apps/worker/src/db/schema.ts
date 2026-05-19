import {
  index,
  integer,
  primaryKey,
  real,
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
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  publishedBy: integer('published_by').references(() => members.id, { onDelete: 'set null' }),
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
});

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
        'session_start',
        'session_complete',
        'members_import',
        'credentials_import',
        'positions_clone',
        'rule_book_clone',
        'dissent',
        'a_day_pick',
        'forced_a_day_pick',
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

export const aiAdvisories = sqliteTable(
  'ai_advisories',
  {
    id: text('id').primaryKey(),
    bidSessionId: text('bid_session_id')
      .notNull()
      .references(() => bidSessions.id, { onDelete: 'cascade' }),
    memberId: integer('member_id'),
    positionId: text('position_id'),
    triggeredBy: text('triggered_by', {
      enum: ['turn_start', 'admin_request', 'periodic_forecast', 'override_check'],
    }).notNull(),
    model: text('model').notNull(),
    promptHash: text('prompt_hash').notNull(),
    responseJson: text('response_json').notNull(),
    renderedMarkdown: text('rendered_markdown').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    costCents: integer('cost_cents').notNull(),
    cacheHitRatio: real('cache_hit_ratio').notNull(),
  },
  (t) => ({
    sessionTriggeredByIdx: index('idx_ai_advisories_session_triggered').on(
      t.bidSessionId,
      t.triggeredBy,
    ),
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
