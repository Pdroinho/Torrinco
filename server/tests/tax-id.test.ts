import { describe, expect, it } from 'vitest';
import { validTaxId } from '../src/billing/tax-id.js';

describe('CPF/CNPJ validation', () => {
  it('accepts valid CPF and CNPJ and rejects invalid check digits and repeated numbers', () => {
    expect(validTaxId('390.533.447-05')).toBe(true);
    expect(validTaxId('11.222.333/0001-81')).toBe(true);
    expect(validTaxId('390.533.447-06')).toBe(false);
    expect(validTaxId('111.111.111-11')).toBe(false);
    expect(validTaxId('123')).toBe(false);
  });
});
