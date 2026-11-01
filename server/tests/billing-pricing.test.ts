import { describe, expect, it } from 'vitest';
import { checkoutAmount } from '../src/billing/pricing.js';

describe('checkout pricing', () => {
  it('applies a 10% Pix discount in cents with normal rounding', () => {
    expect(checkoutAmount(19.90, 'pix')).toBe(17.91);
    expect(checkoutAmount(119.88, 'pix')).toBe(107.89);
    expect(checkoutAmount(19.90, 'card')).toBe(19.90);
    expect(checkoutAmount(119.88, 'card')).toBe(119.88);
  });
});
