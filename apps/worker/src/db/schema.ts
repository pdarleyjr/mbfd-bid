import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
