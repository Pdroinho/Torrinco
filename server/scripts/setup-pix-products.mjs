// Create or verify the one-period products used for manual Pix renewal.
const key = process.env.ABACATEPAY_API_KEY;
if (!key) throw new Error('ABACATEPAY_API_KEY is required');
async function call(path, method = 'GET', body) {
  const response = await fetch(`https://api.abacatepay.com/v2${path}`, {
    method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(`${path}: ${response.status} ${result.error}`);
  return result;
}
const expected = [
  { externalId: 'torrinco-pix-periodo-mensal-v1', name: 'Torrinco - acesso mensal via Pix', price: 1990, currency: 'BRL' },
  { externalId: 'torrinco-pix-periodo-anual-v1', name: 'Torrinco - acesso anual via Pix', price: 11988, currency: 'BRL' },
];
const list = await call('/products/list?limit=100');
if (!Array.isArray(list.data) || list.pagination?.hasMore) throw new Error('Product pagination requires inspection');
for (const product of expected) {
  let item = list.data.find(p => p.externalId === product.externalId);
  if (!item && process.argv.includes('--create')) item = (await call('/products/create', 'POST', product)).data;
  if (!item) { console.log(`${product.externalId}: missing`); continue; }
  if (item.price !== product.price || item.currency !== 'BRL' || item.cycle || item.status !== 'ACTIVE') throw new Error(`Unexpected product: ${product.externalId}`);
  console.log(`${product.externalId}: ${item.id}`);
}
