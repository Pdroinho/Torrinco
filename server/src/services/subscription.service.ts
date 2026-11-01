import { prisma } from '../lib/prisma.js';

export type SubscriptionStatus = 'trial' | 'active' | 'expired' | 'past_due' | 'cancelled';
export type AccountAccessStatus = 'enabled' | 'suspended';
export type PlanFeature = 'calendar' | 'ai' | 'import' | 'installments' | 'shared_cards' | 'advanced_reports' | 'api_access';

export interface AccountAccess {
  allowed: boolean;
  status: SubscriptionStatus;
  accessStatus: AccountAccessStatus;
  reason: string | null;
  inGracePeriod: boolean;
  accessEndsAt: Date | null;
}

export function configuredGracePeriodDays(): number {
  const value = Number(process.env.BILLING_GRACE_PERIOD_DAYS ?? 0);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function evaluateAccountAccess(account: {
  status: SubscriptionStatus | 'suspended' | null;
  access_status?: AccountAccessStatus | null;
  trial_ends_at?: Date | null;
  current_period_ends_at?: Date | null;
  grace_period_ends_at?: Date | null;
}, now = new Date()): AccountAccess {
  const accessStatus = account.access_status ?? (account.status === 'suspended' ? 'suspended' : 'enabled');
  const status = account.status === 'suspended' || account.status === null ? 'expired' : account.status;
  if (accessStatus === 'suspended') {
    return { allowed: false, status, accessStatus, reason: 'ADMINISTRATIVELY_SUSPENDED', inGracePeriod: false, accessEndsAt: null };
  }
  if (status === 'trial') {
    const end = account.trial_ends_at ?? null;
    return end && end.getTime() > now.getTime()
      ? { allowed: true, status, accessStatus, reason: null, inGracePeriod: false, accessEndsAt: end }
      : { allowed: false, status: 'expired', accessStatus, reason: 'TRIAL_EXPIRED', inGracePeriod: false, accessEndsAt: end };
  }
  if (status === 'active') {
    const end = account.current_period_ends_at ?? null;
    if (!end || end.getTime() > now.getTime()) {
      return { allowed: true, status, accessStatus, reason: null, inGracePeriod: false, accessEndsAt: end };
    }
    const configuredDays = configuredGracePeriodDays();
    const configuredEnd = configuredDays > 0 ? new Date(end.getTime() + configuredDays * 86_400_000) : null;
    const graceEnd = account.grace_period_ends_at ?? configuredEnd;
    if (graceEnd && graceEnd.getTime() > now.getTime()) {
      return { allowed: true, status: 'past_due', accessStatus, reason: null, inGracePeriod: true, accessEndsAt: graceEnd };
    }
    return { allowed: false, status: 'expired', accessStatus, reason: 'SUBSCRIPTION_EXPIRED', inGracePeriod: false, accessEndsAt: graceEnd ?? end };
  }
  if (status === 'past_due') {
    const paidEnd = account.current_period_ends_at ?? null;
    const configuredEnd = paidEnd && configuredGracePeriodDays() > 0 ? new Date(paidEnd.getTime() + configuredGracePeriodDays() * 86_400_000) : null;
    const end = account.grace_period_ends_at ?? configuredEnd ?? paidEnd;
    return end && end.getTime() > now.getTime()
      ? { allowed: true, status, accessStatus, reason: null, inGracePeriod: true, accessEndsAt: end }
      : { allowed: false, status, accessStatus, reason: 'PAYMENT_OVERDUE', inGracePeriod: false, accessEndsAt: end };
  }
  return { allowed: false, status, accessStatus, reason: status.toUpperCase(), inGracePeriod: false, accessEndsAt: null };
}

function featuresOf(value: unknown): Record<string, boolean> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, boolean> : {};
}

export async function getAccountEntitlements(accountId: number, now = new Date()) {
  const account = await prisma.accounts.findUnique({ where: { id: accountId }, include: { plans: true } });
  if (!account) throw Object.assign(new Error('ACCOUNT_NOT_FOUND'), { statusCode: 404 });
  const access = evaluateAccountAccess(account as any, now);

  // Trial vencido nunca permanece trial: persiste a transicao e a auditoria.
  if (account.status === 'trial' && access.status === 'expired') {
    await prisma.$transaction(async (tx) => {
      await tx.accounts.update({ where: { id: accountId }, data: { status: 'expired' } });
      await tx.subscription_history.create({ data: { account_id: accountId, plan_id: account.plan_id, previous_status: 'trial', new_status: 'expired', reason: 'trial_expired' } });
    });
  }

  return { account, plan: account.plans, access, features: featuresOf(account.plans.features) };
}

export async function assertAccountAccess(accountId: number) {
  const entitlement = await getAccountEntitlements(accountId);
  if (!entitlement.access.allowed) {
    throw Object.assign(new Error(entitlement.access.reason ?? 'ACCOUNT_ACCESS_DENIED'), { statusCode: 403, code: entitlement.access.reason });
  }
  return entitlement;
}

export async function assertFeature(accountId: number, feature: PlanFeature) {
  const entitlement = await assertAccountAccess(accountId);
  if (entitlement.features[feature] !== true) {
    throw Object.assign(new Error('FEATURE_NOT_INCLUDED'), { statusCode: 403, code: 'FEATURE_NOT_INCLUDED', feature });
  }
  return entitlement;
}

export async function assertWithinLimit(accountId: number, resource: 'users' | 'cards') {
  const entitlement = await assertAccountAccess(accountId);
  const current = resource === 'users'
    ? await prisma.users.count({ where: { account_id: accountId, status: 'active' } })
    : await prisma.financial_entities.count({ where: { account_id: accountId, type: 'credit_card' } });
  const maximum = resource === 'users' ? entitlement.plan.max_users : entitlement.plan.max_cards;
  if (current >= maximum) {
    throw Object.assign(new Error('PLAN_LIMIT_REACHED'), { statusCode: 403, code: 'PLAN_LIMIT_REACHED', resource, current, maximum });
  }
  return { current, maximum };
}

export async function changeSubscriptionStatus(accountId: number, newStatus: SubscriptionStatus, reason: string, metadata?: object) {
  return prisma.$transaction(async (tx) => {
    const account = await tx.accounts.findUnique({ where: { id: accountId } });
    if (!account) throw Object.assign(new Error('ACCOUNT_NOT_FOUND'), { statusCode: 404 });
    if (account.status === newStatus) return account;
    const updated = await tx.accounts.update({
      where: { id: accountId },
      data: { status: newStatus, cancelled_at: newStatus === 'cancelled' ? new Date() : newStatus === 'active' ? null : undefined }
    });
    await tx.subscription_history.create({ data: { account_id: accountId, plan_id: account.plan_id, previous_status: account.status, new_status: newStatus, reason, metadata: metadata as any } });
    return updated;
  });
}

export async function getSubscriptionOverview(accountId: number) {
  const entitlement = await getAccountEntitlements(accountId);
  const [users, cards, history, availablePlans, recurring] = await Promise.all([
    prisma.users.count({ where: { account_id: accountId, status: 'active' } }),
    prisma.financial_entities.count({ where: { account_id: accountId, type: 'credit_card' } }),
    prisma.subscription_history.findMany({ where: { account_id: accountId }, orderBy: { created_at: 'desc' }, take: 25 }),
    // Somente individual esta comercialmente liberado. Precos permanecem os persistidos.
    prisma.plans.findMany({ where: { name: 'individual', status: 'active' }, orderBy: { id: 'asc' } }),
    prisma.billing_subscriptions.findFirst({where:{account_id:accountId,provider:'abacatepay',external_subscription_id:{startsWith:'subs_'}},orderBy:{created_at:'desc'},select:{status:true,current_period_ends_at:true}}),
  ]);
  return {
    status: entitlement.access.status,
    access: entitlement.access,
    plan: entitlement.plan,
    usage: { users: { current: users, maximum: entitlement.plan.max_users }, cards: { current: cards, maximum: entitlement.plan.max_cards } },
    dates: { trialEndsAt: entitlement.account.trial_ends_at, currentPeriodEndsAt: entitlement.account.current_period_ends_at, gracePeriodEndsAt: entitlement.account.grace_period_ends_at, cancelledAt: entitlement.account.cancelled_at },
    availablePlans,
    history,
    recurring: recurring ? {status:recurring.status,currentPeriodEndsAt:recurring.current_period_ends_at} : null,
  };
}
