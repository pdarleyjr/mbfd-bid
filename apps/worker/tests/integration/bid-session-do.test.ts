import { describe, expect, it } from 'vitest';
import { BidSessionDO } from '../../src/durable/bid-session.js';

describe('BidSessionDO class export (Plan 04 Task 7)', () => {
  it('is a constructor', () => {
    expect(typeof BidSessionDO).toBe('function');
    expect(BidSessionDO.prototype).toBeDefined();
  });

  it('declares fetch + admin action methods', () => {
    expect(typeof BidSessionDO.prototype.fetch).toBe('function');
    expect(typeof BidSessionDO.prototype.adminSkip).toBe('function');
    expect(typeof BidSessionDO.prototype.adminForcePick).toBe('function');
    expect(typeof BidSessionDO.prototype.adminFreeze).toBe('function');
    expect(typeof BidSessionDO.prototype.initSession).toBe('function');
  });
});
