export function validTaxId(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (![11, 14].includes(digits.length) || /^(\d)\1+$/.test(digits)) return false;
  const weights = digits.length === 11 ? [10,9,8,7,6,5,4,3,2] : [5,4,3,2,9,8,7,6,5,4,3,2];
  const calc = (value: string, w: number[]) => { const r = [...value].reduce((sum, d, i) => sum + Number(d) * w[i]!, 0) % 11; return r < 2 ? 0 : 11 - r; };
  const base = digits.slice(0, -2), first = calc(base, weights);
  return digits.endsWith(`${first}${calc(base + first, [digits.length === 11 ? 11 : 6, ...weights])}`);
}
