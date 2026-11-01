/** Extends from the later of payment or the end of the previously paid period. */
export function nextPaidPeriodEnd(paidAt: Date, previousEnd: Date | null | undefined, billingPeriodDays: number): Date {
  const start = previousEnd && previousEnd > paidAt ? previousEnd : paidAt;
  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  if (billingPeriodDays === 365) end.setUTCFullYear(end.getUTCFullYear() + 1);
  else if (billingPeriodDays === 30) end.setUTCMonth(end.getUTCMonth() + 1);
  else throw new Error('INVALID_BILLING_PERIOD');
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}
