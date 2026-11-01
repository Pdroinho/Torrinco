// Requires production API deployed and the same secret configured on it.
const key = process.env.ABACATEPAY_API_KEY;
const secret = process.env.ABACATEPAY_WEBHOOK_SECRET;
const apiUrl = process.env.PUBLIC_API_URL;
if (!key || !secret || !apiUrl) throw new Error('ABACATEPAY_API_KEY, ABACATEPAY_WEBHOOK_SECRET and PUBLIC_API_URL are required');
if (secret.length < 32) throw new Error('Webhook secret must contain at least 32 characters');
const endpoint = `${apiUrl.replace(/\/$/, '')}/api/billing/webhook/abacatepay`;
if (!endpoint.startsWith('https://')) throw new Error('Webhook endpoint must use HTTPS');
const events = ['subscription.completed', 'subscription.renewed', 'subscription.payment_failed', 'subscription.cancelled', 'checkout.refunded'];

async function call(path, method = 'GET', body) {
  const response = await fetch(`https://api.abacatepay.com/v2${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) throw new Error(`AbacatePay ${path} failed (HTTP ${response.status})`);
  return result;
}

const list = await call('/webhooks/list?limit=100');
if (!Array.isArray(list.data)) throw new Error('Invalid webhooks/list response');
if (list.pagination?.hasMore || list.pagination?.hasNextPage) throw new Error('Webhook list has more pages; inspect before creating');
const existing = list.data.find(item => item.endpoint === endpoint);
if (existing) throw new Error(`Webhook already exists (${existing.id}); verify its secret and events manually before continuing`);
if (!process.argv.includes('--create')) {
  console.log('Webhook missing; rerun with --create after deploying the API and configuring its secret');
} else {
  const created = (await call('/webhooks/create', 'POST', { name: 'Torrinco assinaturas', endpoint, secret, events })).data;
  console.log(`Webhook created: ${created.id} (${events.join(', ')})`);
}
