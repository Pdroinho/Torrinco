import crypto from 'node:crypto';
import { Router } from 'express';
import type { BillingProvider } from './types.js';
import { BillingOrchestratorService } from '../services/billing-orchestrator.service.js';

/** Ponto único onde o futuro gateway será conectado. Sempre recebe corpo bruto para validar a assinatura antes do JSON. */
export function createBillingWebhookRouter(provider:BillingProvider){
  const router=Router();
  router.post('/',async(req,res,next)=>{try{
    if(!Buffer.isBuffer(req.body))return res.status(400).json({error:'Raw webhook body required'});
    const secret = process.env.ABACATEPAY_WEBHOOK_SECRET;
    const supplied = typeof req.query.webhookSecret === 'string' ? req.query.webhookSecret : '';
    if (!secret || !supplied || Buffer.byteLength(secret) !== Buffer.byteLength(supplied) ||
        !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(supplied))) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }
    const headers = { ...req.headers, 'x-torrinco-webhook-secret': supplied };
    const result=await BillingOrchestratorService.processWebhook(provider,req.body,headers);
    res.status(200).json({received:true,duplicate:result.duplicate,review:'review' in result?result.review:false});
  }catch(error){next(error)}});
  return router;
}
