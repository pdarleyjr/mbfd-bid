import { describe, expect, it } from 'vitest';
import { CredentialImportRowSchema } from '../../src/schemas/credential-import';

describe('CredentialImportRowSchema', () => {
  it('happy path: parses name and numeric fy_points_default', () => {
    const result = CredentialImportRowSchema.safeParse({
      name: 'Driver Engineer Qualified',
      fy_points_default: 4,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Driver Engineer Qualified');
      expect(result.data.fyPointsDefault).toBe(4);
    }
  });

  it('defaults fy_points_default to 0 when omitted', () => {
    const result = CredentialImportRowSchema.safeParse({
      name: 'Hazmat Operations',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fyPointsDefault).toBe(0);
    }
  });

  it('rejects empty name', () => {
    const result = CredentialImportRowSchema.safeParse({
      name: '',
      fy_points_default: 2,
    });
    expect(result.success).toBe(false);
  });

  it('rejects name exceeding 120 chars', () => {
    const result = CredentialImportRowSchema.safeParse({
      name: 'A'.repeat(121),
      fy_points_default: 1,
    });
    expect(result.success).toBe(false);
  });

  it('accepts string for fy_points_default and converts to number', () => {
    const result = CredentialImportRowSchema.safeParse({
      name: 'First Responder',
      fy_points_default: '3',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fyPointsDefault).toBe(3);
    }
  });

  it('trims name and optional fields', () => {
    const result = CredentialImportRowSchema.safeParse({
      name: '  Paramedic  ',
      abbreviation: '  PM  ',
      notes: '  Required for rescue  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Paramedic');
      expect(result.data.abbreviation).toBe('PM');
      expect(result.data.notes).toBe('Required for rescue');
    }
  });

  it('passes through unknown fields (passthrough)', () => {
    const result = CredentialImportRowSchema.safeParse({
      name: 'Water Rescue',
      fy_points_default: 2,
      extra_col: 'future',
    });
    expect(result.success).toBe(true);
  });

  it('sets abbreviation and notes to null when absent', () => {
    const result = CredentialImportRowSchema.safeParse({
      name: 'Hazmat Technician',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.abbreviation).toBeNull();
      expect(result.data.notes).toBeNull();
    }
  });
});
