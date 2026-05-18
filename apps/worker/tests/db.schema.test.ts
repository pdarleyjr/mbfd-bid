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
});
