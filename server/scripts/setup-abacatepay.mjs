// Run with ABACATEPAY_API_KEY in the process environment. Never commit a real key.
const key = process.env.ABACATEPAY_API_KEY;
if (!key) throw new Error('ABACATEPAY_API_KEY is required');
const create = process.argv.includes('--create-products');
const base = 'https://api.abacatepay.com/v2';

async function call(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) throw new Error(`AbacatePay ${path} failed (HTTP ${response.status})`);
  return result;
}

const expected = [
  { externalId: 'torrinco-individual-monthly-v1', name: 'Torrinco Individual Mensal', price: 1990, currency: 'BRL', cycle: 'MONTHLY' },
  { externalId: 'torrinco-individual-yearly-v1', name: 'Torrinco Individual Anual', price: 11988, currency: 'BRL', cycle: 'ANNUALLY' },
];

const result = await call('/products/list?limit=100');
if (!Array.isArray(result.data)) throw new Error('Invalid products/list response');
if (result.pagination?.hasMore || result.pagination?.hasNextPage) throw new Error('Product list has more pages; inspect before creating products');
for (const product of expected) {
  let found = result.data.find(item => item.externalId === product.externalId);
  if (!found && create) found = (await call('/products/create', 'POST', product)).data;
  if (!found) { console.log(`${product.externalId}: missing`); continue; }
  if (found.price !== product.price || found.cycle !== product.cycle || found.currency !== product.currency || found.status !== 'ACTIVE') {
    throw new Error(`${product.externalId}: existing product differs from expected price/cycle/status`);
  }
  console.log(`${product.externalId}: ${found.id}, ${found.price} cents, ${found.cycle}`);
}
