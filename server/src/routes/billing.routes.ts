import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { BillingOrchestratorService } from '../services/billing-orchestrator.service.js';
import { AbacatePayProvider } from '../billing/abacatepay.provider.js';
import { firstAccessLimiter } from '../middleware/rate-limiter.js';
import { prisma } from '../lib/prisma.js';

const router = Router();
const requestSchema = z.object({
  idempotencyKey: z.uuid(),
  billingPeriod: z.enum(['monthly', 'yearly']),
  name: z.string().trim().min(2).max(100),
  phone: z.string().regex(/^[+()\d\s-]{10,30}$/),
  email: z.email().max(150),
});

router.post('/checkout', firstAccessLimiter, async (req, res, next) => {
  try {
    const secret = process.env.BILLING_INTERNAL_SECRET;
    const supplied = req.get('x-torrinco-billing-token') ?? '';
    if (!secret || Buffer.byteLength(secret) !== Buffer.byteLength(supplied) ||
      !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(supplied))) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const input = requestSchema.parse(req.body);
    const existingUser = await prisma.users.findUnique({where:{phone_number:input.phone.replace(/\D/g,'')}});
    if (existingUser && await prisma.billing_subscriptions.count({where:{account_id:existingUser.account_id,provider:'abacatepay',status:{in:['active','past_due']}}})) {
      return res.status(409).json({error:'Já existe assinatura recorrente para este WhatsApp. Entre no app para gerenciá-la.'});
    }
    const order = await BillingOrchestratorService.createOrder({ ...input, planName: 'individual' });
    if (order.customer_phone !== input.phone.replace(/\D/g, '') || order.customer_email?.toLowerCase() !== input.email.toLowerCase() || order.billing_period_days !== (input.billingPeriod === 'yearly' ? 365 : 30)) {
      return res.status(409).json({ error: 'Idempotency key belongs to another request' });
    }
    const checkout = await BillingOrchestratorService.createCheckout(order.public_id, new AbacatePayProvider());
    return res.json({ url: checkout.checkout_url });
  } catch (error) { next(error); }
});

export default router;
