export type InternalBillingEventType =
  | 'checkout.created' | 'checkout.ignored' | 'payment.pending' | 'payment.approved' | 'payment.failed'
  | 'subscription.activated' | 'subscription.renewed' | 'subscription.past_due' | 'subscription.cancelled' | 'payment.refunded';

export interface CheckoutRequest { orderPublicId:string; amount:string; currency:string; billingPeriod:'monthly'|'yearly'; paymentMethod?:'pix'|'card'; customer:{name:string;phone:string;email?:string;taxId?:string}; description:string }
export interface CheckoutResult { externalCheckoutId:string; checkoutUrl:string; expiresAt?:Date }
export interface ProviderStatus { status:string; externalId:string }
export interface InternalBillingEvent {
  providerEventId:string; type:InternalBillingEventType; orderPublicId:string; occurredAt:Date;
  externalCheckoutId?:string; externalPaymentId?:string; externalCustomerId?:string; externalSubscriptionId?:string;
  amount?:string; currency?:string; planReference?:string; currentPeriodEndsAt?:Date; raw:unknown;
}
export interface BillingProvider {
  readonly name:string;
  createCheckout(request:CheckoutRequest):Promise<CheckoutResult>;
  getStatus(externalId:string):Promise<ProviderStatus>;
  cancelSubscription(externalSubscriptionId:string):Promise<void>;
  validateAndMapWebhook(rawBody:Buffer,headers:Record<string,string|string[]|undefined>):Promise<InternalBillingEvent>;
}
