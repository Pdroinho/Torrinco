import crypto from 'node:crypto';
import type { BillingProvider, CheckoutRequest, CheckoutResult, InternalBillingEvent, ProviderStatus } from './types.js';

// Chave pública de integridade documentada pelo AbacatePay; o secret privado fica somente no ambiente.
const WEBHOOK_HMAC_KEY = 't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';
const API_BASE = 'https://api.abacatepay.com/v2';

function configured(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw Object.assign(new Error(`${name}_NOT_CONFIGURED`), { statusCode: 503 });
  return value;
}

function secureEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function optionalDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export class AbacatePayProvider implements BillingProvider {
  readonly name = 'abacatepay';

  private async request<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${configured('ABACATEPAY_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const envelope = await response.json().catch(() => null) as { success?: boolean; data?: T } | null;
    if (!response.ok || !envelope?.success || !envelope.data) {
      // Nunca registre o corpo: alguns erros do gateway podem ecoar dados do cliente.
      throw Object.assign(new Error('ABACATEPAY_REQUEST_FAILED'), { statusCode: 502, upstreamStatus: response.status });
    }
    return envelope.data;
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    if (request.currency !== 'BRL') throw new Error('UNSUPPORTED_CURRENCY');
    const recurring = request.paymentMethod === 'card';
    const productId = configured(recurring
      ? request.billingPeriod === 'yearly' ? 'ABACATEPAY_YEARLY_PRODUCT_ID' : 'ABACATEPAY_MONTHLY_PRODUCT_ID'
      : request.billingPeriod === 'yearly' ? 'ABACATEPAY_PIX_YEARLY_PRODUCT_ID' : 'ABACATEPAY_PIX_MONTHLY_PRODUCT_ID');
    const landingUrl = configured('PUBLIC_LANDING_URL').replace(/\/$/, '');
    if (!request.customer.email) throw new Error('CHECKOUT_CUSTOMER_EMAIL_REQUIRED');
    const digits = request.customer.phone.replace(/\D/g, '');
    const cellphone = digits.length > 11 && digits.startsWith('55') ? `+${digits}` : `+55${digits}`;
    const customer = await this.request<{ id: string }>('/customers/create', 'POST', {
      name: request.customer.name,
      email: request.customer.email,
      cellphone,
      ...(request.customer.taxId ? { taxId: request.customer.taxId.replace(/\D/g, '') } : {}),
    });
    if (!customer.id?.startsWith('cust_')) throw new Error('INVALID_ABACATEPAY_CUSTOMER_RESPONSE');
    const checkout = await this.request<{ id: string; url: string; amount: number; items: Array<{id:string;quantity:number}> }>(
      recurring ? '/subscriptions/create' : '/checkouts/create',
      'POST',
      {
        items: [{ id: productId, quantity: 1 }],
        customerId: customer.id,
        externalId: request.orderPublicId,
        methods: [recurring ? 'CARD' : 'PIX'],
        returnUrl: `${landingUrl}/#planos`,
        completionUrl: `${landingUrl}/obrigado`,
        metadata: { orderPublicId: request.orderPublicId },
      },
    );
    if (!checkout.id?.startsWith('bill_') || !checkout.url?.startsWith('https://')) {
      throw new Error('INVALID_ABACATEPAY_CHECKOUT_RESPONSE');
    }
    const firstItem = checkout.items?.[0];
    if (checkout.amount !== Math.round(Number(request.amount) * 100) || checkout.items?.length !== 1 || firstItem?.id !== productId || firstItem?.quantity !== 1) {
      throw Object.assign(new Error('ABACATEPAY_PRODUCT_PRICE_MISMATCH'), { statusCode: 409 });
    }
    return { externalCheckoutId: checkout.id, checkoutUrl: checkout.url };
  }

  async getStatus(externalId: string): Promise<ProviderStatus> {
    const checkout = await this.request<{ id: string; status: string }>(
      `/subscriptions/checkouts/get?id=${encodeURIComponent(externalId)}`, 'GET',
    );
    return { externalId: checkout.id, status: checkout.status };
  }

  async cancelSubscription(externalSubscriptionId: string): Promise<void> {
    if (!externalSubscriptionId.startsWith('subs_')) throw new Error('INVALID_SUBSCRIPTION_ID');
    const subscription = await this.request<{ id:string;status:string }>(`/subscriptions/cancel`, 'POST', { id: externalSubscriptionId });
    if (subscription.id !== externalSubscriptionId || subscription.status !== 'CANCELLED') throw new Error('ABACATEPAY_CANCELLATION_NOT_CONFIRMED');
  }

  async validateAndMapWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<InternalBillingEvent> {
    const suppliedSecret = String(headers['x-torrinco-webhook-secret'] ?? '');
    const signature = String(headers['x-webhook-signature'] ?? '');
    const secret = configured('ABACATEPAY_WEBHOOK_SECRET');
    const expectedSignature = crypto.createHmac('sha256', WEBHOOK_HMAC_KEY).update(rawBody).digest('base64');
    if (!secureEqual(suppliedSecret, secret) || !secureEqual(signature, expectedSignature)) {
      throw Object.assign(new Error('INVALID_WEBHOOK_SIGNATURE'), { statusCode: 401 });
    }
    const body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    if (typeof body.id !== 'string' || typeof body.event !== 'string' || !body.id.startsWith('log_')) {
      throw Object.assign(new Error('INVALID_WEBHOOK_BODY'), { statusCode: 400 });
    }
    if (configured('ABACATEPAY_API_KEY').startsWith('abc_prod_') && body.devMode !== false) {
      throw Object.assign(new Error('INVALID_WEBHOOK_ENVIRONMENT'), { statusCode: 400 });
    }
    const data = object(body.data);
    const subscription = object(data.subscription);
    const checkout = object(data.checkout);
    const payment = object(data.payment);
    const customer = object(data.customer);
    const mapping: Record<string, InternalBillingEvent['type']> = {
      'checkout.completed': 'payment.approved',
      'subscription.completed': 'subscription.activated',
      'subscription.renewed': 'subscription.renewed',
      'subscription.payment_failed': 'subscription.past_due',
      'subscription.cancelled': 'subscription.cancelled',
      'checkout.refunded': 'payment.refunded',
    };
    let type = mapping[body.event];
    if (!type) throw Object.assign(new Error('UNSUPPORTED_WEBHOOK_EVENT'), { statusCode: 400 });
    const occurredAt = optionalDate(payment.updatedAt) ?? optionalDate(subscription.updatedAt) ?? optionalDate(checkout.updatedAt) ?? new Date();
    const amountCents = Number(payment.paidAmount ?? payment.amount ?? checkout.paidAmount ?? subscription.amount);
    const productId = Array.isArray(checkout.items) ? object(checkout.items[0]).id : undefined;
    const knownProduct = [process.env.ABACATEPAY_MONTHLY_PRODUCT_ID, process.env.ABACATEPAY_YEARLY_PRODUCT_ID, process.env.ABACATEPAY_PIX_MONTHLY_PRODUCT_ID, process.env.ABACATEPAY_PIX_YEARLY_PRODUCT_ID, process.env.ABACATEPAY_PIX_MONTHLY_LEGACY_PRODUCT_ID, process.env.ABACATEPAY_PIX_YEARLY_LEGACY_PRODUCT_ID, process.env.ABACATEPAY_PIX_TEST_PRODUCT_ID].includes(productId);
    if (body.event === 'checkout.completed' && checkout.frequency && checkout.frequency !== 'ONE_TIME') type = 'checkout.ignored';
    if (body.event === 'checkout.completed' && type !== 'checkout.ignored' && (checkout.frequency !== 'ONE_TIME' || checkout.status !== 'PAID' || checkout.isUpSell === true)) {
      throw Object.assign(new Error('INVALID_PIX_CHECKOUT_EVENT'), { statusCode: 400 });
    }
    return {
      providerEventId: body.id,
      type,
      orderPublicId: String(checkout.externalId ?? payment.externalId ?? ''),
      occurredAt,
      externalCheckoutId: typeof checkout.id === 'string' ? checkout.id : typeof subscription.checkoutId === 'string' ? subscription.checkoutId : undefined,
      externalPaymentId: typeof payment.id === 'string' ? payment.id : undefined,
      externalCustomerId: typeof customer.id === 'string' ? customer.id : typeof subscription.customerId === 'string' ? subscription.customerId : undefined,
      externalSubscriptionId: typeof subscription.id === 'string' ? subscription.id : undefined,
      amount: Number.isInteger(amountCents) ? (amountCents / 100).toFixed(2) : undefined,
      currency: typeof subscription.currency === 'string' ? subscription.currency : typeof payment.currency === 'string' ? payment.currency : 'BRL',
      planReference: productId ? knownProduct ? 'individual' : `unknown:${productId}` : undefined,
      currentPeriodEndsAt: optionalDate(subscription.currentPeriodEndsAt ?? subscription.nextBilling),
      raw: body,
    };
  }
}
