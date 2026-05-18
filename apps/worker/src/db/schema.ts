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
