/** Money is converted to cents before applying the Pix discount. */
export function checkoutAmount(baseAmount: number, method?: 'pix'|'card'): number {
  const cents = Math.round(baseAmount * 100);
  return (method === 'pix' ? Math.round(cents * 0.9) : cents) / 100;
}
