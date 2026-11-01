import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { nextPaidPeriodEnd } from '../billing/paid-period.js';

const DEFAULT_CATEGORIES = [
  ['Salário','income','#22c55e'],['Freelance','income','#10b981'],['Investimentos','income','#0ea5e9'],['Presentes','income','#8b5cf6'],['Outros','income','#64748b'],
  ['Alimentação','expense','#ef4444'],['Moradia','expense','#f97316'],['Transporte','expense','#eab308'],['Saúde','expense','#ec4899'],['Educação','expense','#3b82f6'],['Lazer','expense','#8b5cf6'],['Compras','expense','#f43f5e'],['Contas Fixas','expense','#6366f1'],
] as const;

export interface ProvisionAccountInput {
  name: string; phone: string; email?: string; planName: string; trialDays: number;
  origin: 'platform_tester'|'whatsapp_onboarding'|'checkout'|'manual'; createdBy?: number;
  note?: string;
}

export class AccountProvisioningService {
  static normalizePhone(phone: string) { return phone.replace(/\D/g, ''); }

  static async provision(input: ProvisionAccountInput) {
    const phone = this.normalizePhone(input.phone);
    if (await prisma.users.findUnique({ where: { phone_number: phone } })) {
      throw Object.assign(new Error('Telefone já cadastrado'), { statusCode: 409, code: 'PHONE_ALREADY_EXISTS' });
    }
    const plainToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(plainToken).digest('hex');
    const trialEndsAt = new Date(Date.now() + input.trialDays * 86_400_000);
    const expiresAt = new Date(Date.now() + Number(process.env.PLATFORM_INVITE_EXPIRES_HOURS ?? 72) * 3_600_000);

    const result = await prisma.$transaction(async (tx) => {
      const plan = await tx.plans.findUnique({ where: { name: input.planName } });
      if (!plan || plan.status !== 'active') throw Object.assign(new Error('Plano inválido'), { statusCode: 400 });
      const account = await tx.accounts.create({ data: { name: input.name, plan_id: plan.id, status: 'trial', trial_ends_at: trialEndsAt, origin: input.origin } });
      const user = await tx.users.create({ data: { account_id: account.id, phone_number: phone, email: input.email, name: input.name, role: 'owner', status: 'active' } });
      await tx.account_members.create({ data: { account_id: account.id, user_id: user.id, role: 'owner', status: 'active' } });
      await tx.categories.createMany({ data: DEFAULT_CATEGORIES.map(([name,type,color]) => ({ account_id: account.id, name, type, color })), skipDuplicates: true });
      await tx.subscription_history.create({ data: { account_id: account.id, plan_id: plan.id, new_status: 'trial', reason: 'account_provisioned', metadata: { origin: input.origin } } });
      const invitation = await tx.account_invitations.create({ data: { user_id: user.id, account_id: account.id, purpose: 'first_access', token_hash: tokenHash, expires_at: expiresAt, created_by: input.createdBy, metadata: { note: input.note } } });
      return { account, user, invitation, plan };
    });
    return { ...result, plainToken };
  }

  static async activatePaidOrder(input: {
    orderId:number; name:string; phone:string; email?:string|null; planId:number;
    existingUserId?:number|null; existingAccountId?:number|null; periodEndsAt:Date; paidAt?:Date; billingPeriodDays?:number;
    billing?: {provider:string; externalSubscriptionId:string; externalCustomerId?:string; occurredAt:Date};
  }) {
    const phone=this.normalizePhone(input.phone);const plainToken=crypto.randomBytes(32).toString('base64url');const tokenHash=crypto.createHash('sha256').update(plainToken).digest('hex');
    return prisma.$transaction(async tx=>{
      const plan=await tx.plans.findUnique({where:{id:input.planId}});
      if(!plan||plan.status!=='active')throw new Error('ORDER_PLAN_NOT_AVAILABLE');
      let user=input.existingUserId?await tx.users.findUnique({where:{id:input.existingUserId}}):await tx.users.findUnique({where:{phone_number:phone}});
      let account=input.existingAccountId?await tx.accounts.findUnique({where:{id:input.existingAccountId}}):null;
      if(user&&!account)account=await tx.accounts.findUnique({where:{id:user.account_id}});
      if(user&&account&&user.account_id!==account.id)throw new Error('ORDER_ACCOUNT_MISMATCH');
      // Serialize extensions to prevent simultaneous payments from overwriting paid time.
      if (account && input.paidAt && input.billingPeriodDays) {
        await tx.$queryRaw`SELECT id FROM accounts WHERE id = ${account.id} FOR UPDATE`;
        account = await tx.accounts.findUniqueOrThrow({where:{id:account.id}});
        input.periodEndsAt = nextPaidPeriodEnd(input.paidAt, account.current_period_ends_at, input.billingPeriodDays);
      }
      const previousStatus=account?.status??null;
      if(!account)account=await tx.accounts.create({data:{name:input.name,plan_id:plan.id,status:'active',current_period_ends_at:input.periodEndsAt,origin:'checkout'}});
      else account=await tx.accounts.update({where:{id:account.id},data:{plan_id:plan.id,status:'active',trial_ends_at:null,current_period_ends_at:input.periodEndsAt,cancelled_at:null,grace_period_ends_at:null}});
      if(!user)user=await tx.users.create({data:{account_id:account.id,phone_number:phone,email:input.email??undefined,name:input.name,role:'owner',status:'active'}});
      await tx.account_members.upsert({where:{account_id_user_id:{account_id:account.id,user_id:user.id}},create:{account_id:account.id,user_id:user.id,role:user.role??'member',status:'active'},update:{}});
      await tx.categories.createMany({data:DEFAULT_CATEGORIES.map(([name,type,color])=>({account_id:account!.id,name,type,color})),skipDuplicates:true});
      await tx.subscription_history.create({data:{account_id:account.id,plan_id:plan.id,previous_status:previousStatus,new_status:'active',reason:previousStatus==='trial'?'trial_converted_by_payment':'payment_approved',metadata:{orderId:input.orderId}}});
      let invitation=null;if(!user.password_hash)invitation=await tx.account_invitations.create({data:{user_id:user.id,account_id:account.id,purpose:'first_access',token_hash:tokenHash,status:'pending',expires_at:new Date(Date.now()+Number(process.env.PLATFORM_INVITE_EXPIRES_HOURS??72)*3_600_000),metadata:{orderId:input.orderId,origin:'checkout'}}});
      if (input.billing) {
        const b=input.billing;
        await tx.accounts.updateMany({where:{id:account.id,access_status:'suspended',access_suspension_reason:'payment_refunded'},data:{access_status:'enabled',access_suspended_at:null,access_suspension_reason:null,access_suspended_by_user_id:null}});
        await tx.commerce_orders.update({where:{id:input.orderId},data:{user_id:user.id,account_id:account.id,status:'paid',review_reason:null}});
        await tx.billing_subscriptions.upsert({where:{provider_external_subscription_id:{provider:b.provider,external_subscription_id:b.externalSubscriptionId}},create:{order_id:input.orderId,account_id:account.id,provider:b.provider,external_customer_id:b.externalCustomerId,external_subscription_id:b.externalSubscriptionId,status:'active',current_period_starts_at:b.occurredAt,current_period_ends_at:account.current_period_ends_at,last_event_at:b.occurredAt},update:{status:'active',current_period_ends_at:account.current_period_ends_at,last_event_at:b.occurredAt}});
      }
      return {account,user,plan,invitation,plainToken:invitation?plainToken:undefined};
    });
  }
}
