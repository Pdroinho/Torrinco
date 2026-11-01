import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { BillingOrchestratorService } from '../services/billing-orchestrator.service.js';
import { AbacatePayProvider } from '../billing/abacatepay.provider.js';
import { prisma } from '../lib/prisma.js';

const router = Router();
// The landing calls this endpoint server-to-server. IP-based first-access limits
// would group all buyers together behind the same proxy.
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => crypto.createHash('sha256').update(String(req.body?.phone ?? '').replace(/\D/g, '')).digest('hex'),
  message: { error: 'Muitas tentativas para este telefone. Tente novamente em 15 minutos.' },
});
const requestSchema = z.object({
  idempotencyKey: z.uuid(),
  billingPeriod: z.enum(['monthly', 'yearly']),
  name: z.string().trim().min(2).max(100),
  phone: z.string().regex(/^[+()\d\s-]{10,30}$/),
  email: z.email().max(150),
});

router.post('/checkout', (req, res, next) => {
  const secret = process.env.BILLING_INTERNAL_SECRET;
  const supplied = req.get('x-torrinco-billing-token') ?? '';
  if (!secret || Buffer.byteLength(secret) !== Buffer.byteLength(supplied) ||
    !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(supplied))) return res.status(401).json({ error: 'Unauthorized' });
  next();
}, checkoutLimiter, async (req, res, next) => {
  try {
    const input = requestSchema.parse(req.body);
    const existingUser = await prisma.users.findUnique({where:{phone_number:input.phone.replace(/\D/g,'')}});
    if (existingUser && await prisma.billing_subscriptions.count({where:{account_id:existingUser.account_id,provider:'abacatepay',external_subscription_id:{startsWith:'subs_'},status:{in:['active','past_due']}}})) {
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
