import { describe, expect, it } from 'vitest';
import { nextPaidPeriodEnd } from '../src/billing/paid-period.js';

describe('manual Pix paid period', () => {
  it('keeps the remaining time when a customer renews early', () => {
    expect(nextPaidPeriodEnd(new Date('2030-01-10T12:00:00Z'), new Date('2030-01-31T12:00:00Z'), 30).toISOString()).toBe('2030-02-28T12:00:00.000Z');
  });
  it('starts a new period at payment time after expiry', () => {
    expect(nextPaidPeriodEnd(new Date('2030-03-10T12:00:00Z'), new Date('2030-02-28T12:00:00Z'), 30).toISOString()).toBe('2030-04-10T12:00:00.000Z');
  });
  it('preserves annual periods across leap day', () => {
    expect(nextPaidPeriodEnd(new Date('2028-02-29T12:00:00Z'), null, 365).toISOString()).toBe('2029-02-28T12:00:00.000Z');
  });
});
