import { describe, expect, it } from 'vitest';
import * as schema from '../src/db/schema';

describe('db schema (Plan 02)', () => {
  it('exports members table with required columns', () => {
    expect(schema.members).toBeDefined();
    expect(schema.members.employeeId).toBeDefined();
    expect(schema.members.rank).toBeDefined();
    expect(schema.members.bidCategory).toBeDefined();
    expect(schema.members.rscSeniority).toBeDefined();
  });
  it('exports credentials + member_credentials', () => {
    expect(schema.credentials).toBeDefined();
    expect(schema.memberCredentials).toBeDefined();
  });
  it('members.isProbationary is a boolean-mode column with default false', () => {
    const col = schema.members.isProbationary;
    expect(col).toBeDefined();
    // drizzle exposes column metadata via the internal config object
    const config = (col as unknown as { config: Record<string, unknown> }).config;
    expect(config.hasDefault).toBe(true);
    expect(config.default).toBe(false);
    expect(config.mode).toBe('boolean');
  });
  it('exports position_templates, positions, rule_books, position_rules', () => {
    expect(schema.positionTemplates).toBeDefined();
    expect(schema.positions).toBeDefined();
    expect(schema.ruleBooks).toBeDefined();
    expect(schema.positionRules).toBeDefined();
  });
  it('positions table has compound natural key (id, templateVersion)', () => {
    expect(schema.positions.id).toBeDefined();
    expect(schema.positions.templateVersion).toBeDefined();
  });
  it('exports bid_years, bid_sessions, bid_order, bids, audit_log, snapshots, writeback queue', () => {
    expect(schema.bidYears).toBeDefined();
    expect(schema.bidSessions).toBeDefined();
    expect(schema.bidOrder).toBeDefined();
    expect(schema.bids).toBeDefined();
    expect(schema.auditLog).toBeDefined();
    expect('aiAdvisories' in schema).toBe(false);
    expect(schema.bidSessionSnapshots).toBeDefined();
    expect(schema.portalWritebackQueue).toBeDefined();
  });
  it('bid_sessions has multi-day fields (scheduled_resume_at, expected_duration_days, day_count)', () => {
    expect(schema.bidSessions.scheduledResumeAt).toBeDefined();
    expect(schema.bidSessions.expectedDurationDays).toBeDefined();
    expect(schema.bidSessions.dayCount).toBeDefined();
  });
  it('bids has portal write-back tracking columns', () => {
    expect(schema.bids.portalSyncStatus).toBeDefined();
    expect(schema.bids.portalSyncAttempts).toBeDefined();
  });
});
