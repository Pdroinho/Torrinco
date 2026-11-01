import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbacatePayProvider } from '../src/billing/abacatepay.provider.js';

const PUBLIC_HMAC_KEY = 't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';

describe('AbacatePay v2 recurring contract', () => {
  beforeEach(() => {
    vi.stubEnv('ABACATEPAY_API_KEY', 'abc_prod_test-only');
    vi.stubEnv('ABACATEPAY_MONTHLY_PRODUCT_ID', 'prod_month');
    vi.stubEnv('ABACATEPAY_YEARLY_PRODUCT_ID', 'prod_year');
    vi.stubEnv('ABACATEPAY_PIX_MONTHLY_PRODUCT_ID', 'prod_pix_month');
    vi.stubEnv('ABACATEPAY_PIX_YEARLY_PRODUCT_ID', 'prod_pix_year');
    vi.stubEnv('ABACATEPAY_WEBHOOK_SECRET', 'test-secret');
    vi.stubEnv('PUBLIC_LANDING_URL', 'https://torrinco.com.br');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('creates a monthly Pix checkout with the configured one-period product', async () => {
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      if (_url.endsWith('/customers/create')) {
        expect(body).toEqual({name:'Teste',email:'teste@example.org',cellphone:'+5579999999999'});
        return { ok:true, status:200, json:async()=>({success:true,data:{id:'cust_1'}}) };
      }
      expect(body).toMatchObject({ customerId:'cust_1', externalId: 'order-1', methods: ['PIX'], items: [{ id: 'prod_pix_month', quantity: 1 }] });
      expect(body.frequency).toBeUndefined();
      return { ok: true, status: 200, json: async () => ({ success: true, data: { id: 'bill_1', url: 'https://app.abacatepay.com/pay/bill_1', amount: 1990, items: body.items } }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await new AbacatePayProvider().createCheckout({ orderPublicId: 'order-1', amount: '19.90', currency: 'BRL', billingPeriod: 'monthly', customer: { name: 'Teste', phone: '5579999999999', email:'teste@example.org' }, description: 'Torrinco' });
    expect(result.externalCheckoutId).toBe('bill_1');
  });

  it('rejects a checkout whose gateway price differs from the order', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url:string) => ({ ok: true, status: 200, json: async () => ({ success: true, data: url.endsWith('/customers/create') ? {id:'cust_1'} : { id: 'bill_1', url: 'https://app.abacatepay.com/pay/bill_1', amount: 990, items: [{ id: 'prod_pix_year', quantity: 1 }] } }) })));
    await expect(new AbacatePayProvider().createCheckout({ orderPublicId: 'order-1', amount: '119.88', currency: 'BRL', billingPeriod: 'yearly', customer: { name: 'Teste', phone: '5579999999999',email:'teste@example.org' }, description: 'Torrinco' })).rejects.toThrow('PRODUCT_PRICE_MISMATCH');
  });

  it('maps a signed activation using the subscription checkoutId', async () => {
    const raw = Buffer.from(JSON.stringify({ id: 'log_1', event: 'subscription.completed', apiVersion: 2, devMode: false, data: { subscription: { id: 'subs_1', checkoutId: 'bill_1', amount: 1990, customerId: 'cust_1', updatedAt: '2026-10-31T12:00:00Z' } } }));
    const signature = crypto.createHmac('sha256', PUBLIC_HMAC_KEY).update(raw).digest('base64');
    const event = await new AbacatePayProvider().validateAndMapWebhook(raw, { 'x-torrinco-webhook-secret': 'test-secret', 'x-webhook-signature': signature });
    expect(event).toMatchObject({ type: 'subscription.activated', externalCheckoutId: 'bill_1', externalSubscriptionId: 'subs_1', amount: '19.90', currency: 'BRL' });
    await expect(new AbacatePayProvider().validateAndMapWebhook(raw, { 'x-torrinco-webhook-secret': 'test-secret', 'x-webhook-signature': 'invalid' })).rejects.toMatchObject({ statusCode: 401 });
  });

  it('maps a confirmed one-time Pix checkout and rejects an unpaid event', async () => {
    async function map(status: string) {
      const raw = Buffer.from(JSON.stringify({ id:'log_pix', event:'checkout.completed', devMode:false, data:{ checkout:{id:'bill_pix',externalId:'order-1',frequency:'ONE_TIME',status,paidAmount:1990,items:[{id:'prod_pix_month',quantity:1}]} } }));
      const signature = crypto.createHmac('sha256', PUBLIC_HMAC_KEY).update(raw).digest('base64');
      return new AbacatePayProvider().validateAndMapWebhook(raw, {'x-torrinco-webhook-secret':'test-secret','x-webhook-signature':signature});
    }
    expect(await map('PAID')).toMatchObject({type:'payment.approved',amount:'19.90',externalCheckoutId:'bill_pix',orderPublicId:'order-1'});
    await expect(map('PENDING')).rejects.toMatchObject({statusCode:400});
  });
});
