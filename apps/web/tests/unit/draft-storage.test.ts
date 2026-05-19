// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDraft, draftKey, loadDraft, saveDraft } from '../../lib/draft-storage';

describe('draftKey', () => {
  it('joins route and form id with a stable prefix', () => {
    expect(draftKey('/admin/positions/A101/edit', 'rule')).toBe(
      'mbfd-bid:draft:/admin/positions/A101/edit:rule',
    );
  });
});

describe('localStorage draft lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date('2026-05-17T12:00:00Z'));
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('saves and loads a draft, including savedAt', () => {
    saveDraft('/admin/positions/A101/edit', 'rule', { foo: 1 });
    const got = loadDraft<{ foo: number }>('/admin/positions/A101/edit', 'rule');
    expect(got?.values).toEqual({ foo: 1 });
    expect(got?.savedAt).toBe('2026-05-17T12:00:00.000Z');
  });

  it('returns null when no draft is present', () => {
    expect(loadDraft('/admin/positions/A101/edit', 'rule')).toBeNull();
  });

  it('returns null when stored JSON is malformed', () => {
    window.localStorage.setItem(draftKey('/x', 'f'), '{not json');
    expect(loadDraft('/x', 'f')).toBeNull();
  });

  it('deleteDraft removes the key', () => {
    saveDraft('/admin/positions/A101/edit', 'rule', { foo: 1 });
    deleteDraft('/admin/positions/A101/edit', 'rule');
    expect(loadDraft('/admin/positions/A101/edit', 'rule')).toBeNull();
  });
});
