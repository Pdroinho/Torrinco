export function validTaxId(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (![11, 14].includes(digits.length) || /^(\d)\1+$/.test(digits)) return false;
  const weights = digits.length === 11 ? [10,9,8,7,6,5,4,3,2] : [5,4,3,2,9,8,7,6,5,4,3,2];
  const calc = (value: string, w: number[]) => { const r = [...value].reduce((sum, d, i) => sum + Number(d) * w[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  const base = digits.slice(0, -2), first = calc(base, weights);
  return digits.endsWith(`${first}${calc(base + first, [digits.length === 11 ? 11 : 6, ...weights])}`);
}

export function formatTaxId(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 11) return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
  return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\/\d{4})(\d)/, "$1-$2");
}
