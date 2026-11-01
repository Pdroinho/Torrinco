import type { Response, NextFunction } from 'express';
import type { JwtRequest } from '../middleware/jwt.js';
import { changeSubscriptionStatus, getSubscriptionOverview } from '../services/subscription.service.js';
import { prisma } from '../lib/prisma.js';
import { AbacatePayProvider } from '../billing/abacatepay.provider.js';
import { BillingOrchestratorService } from '../services/billing-orchestrator.service.js';
import { z } from 'zod';
export class SubscriptionController {
  static async overview(req: JwtRequest, res: Response, next: NextFunction) { try { res.json(await getSubscriptionOverview(req.accountId!)); } catch (e) { next(e); } }
  static async checkout(req: JwtRequest, res: Response, next: NextFunction) {
    try {
      if (req.userRole !== 'owner' && req.userRole !== 'admin') return res.status(403).json({error:'Admin requerido'});
      const input = z.object({billingPeriod:z.enum(['monthly','yearly']),idempotencyKey:z.uuid(),email:z.email()}).parse(req.body);
      const active = await prisma.billing_subscriptions.findFirst({where:{account_id:req.accountId!,provider:'abacatepay',status:{in:['active','past_due']}}});
      if (active) return res.status(409).json({error:'Já existe uma assinatura recorrente ativa.'});
      const user = await prisma.users.findUniqueOrThrow({where:{id:req.userId!}});
      const order = await BillingOrchestratorService.createOrder({idempotencyKey:input.idempotencyKey,planName:'individual',billingPeriod:input.billingPeriod,name:user.name??'Cliente Torrinco',phone:user.phone_number,email:input.email,userId:user.id,accountId:req.accountId});
      if(order.account_id!==req.accountId||order.user_id!==req.userId||order.billing_period_days!==(input.billingPeriod==='yearly'?365:30))return res.status(409).json({error:'Chave de solicitação já utilizada.'});
      const checkout=await BillingOrchestratorService.createCheckout(order.public_id,new AbacatePayProvider());
      return res.json({url:checkout.checkout_url});
    } catch(e){next(e)}
  }
  static async cancel(req: JwtRequest, res: Response, next: NextFunction) {
    try {
      if (req.userRole !== 'owner' && req.userRole !== 'admin') return res.status(403).json({ error: 'Admin requerido' });
      const active = await prisma.billing_subscriptions.findFirst({where:{account_id:req.accountId!,provider:'abacatepay',status:{in:['active','past_due']}},orderBy:{created_at:'desc'}});
      if (active) {
        if (!active.external_subscription_id?.startsWith('subs_')) return res.status(409).json({error:'Assinatura sem identificador externo. Contate o suporte.'});
        await new AbacatePayProvider().cancelSubscription(active.external_subscription_id);
        await prisma.billing_subscriptions.update({where:{id:active.id},data:{status:'cancelled'}});
        return res.json({cancelled:true,accessUntil:active.current_period_ends_at});
      }
      return res.status(409).json({error:'Nenhuma assinatura recorrente ativa para cancelar.'});
    } catch (e) { next(e); }
  }
  static async reactivate(req: JwtRequest, res: Response, next: NextFunction) {
    try {
      if (req.userRole !== 'owner' && req.userRole !== 'admin') return res.status(403).json({ error: 'Admin requerido' });
      if (await prisma.billing_subscriptions.count({where:{account_id:req.accountId!,provider:'abacatepay'}})) return res.status(409).json({error:'Para voltar a assinar, inicie uma nova compra.',code:'NEW_CHECKOUT_REQUIRED'});
      const o = await getSubscriptionOverview(req.accountId!);
      const until = o.dates.currentPeriodEndsAt ?? o.dates.trialEndsAt;
      if (!until || new Date(until).getTime() <= Date.now()) return res.status(409).json({ error: 'Pagamento necessario', code: 'PAYMENT_REQUIRED' });
      const status = o.dates.trialEndsAt && !o.dates.currentPeriodEndsAt ? 'trial' : 'active';
      res.json({ account: await changeSubscriptionStatus(req.accountId!, status, 'reactivated_by_account_admin') });
    } catch (e) { next(e); }
  }
}
