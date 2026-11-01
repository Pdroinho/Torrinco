import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma.js', () => ({ prisma: { users:{findUnique:vi.fn(async()=>null)} } }));
vi.mock('../src/services/billing-orchestrator.service.js', () => ({ BillingOrchestratorService:{
  createOrder:vi.fn(async(input:any)=>({public_id:'test-order',customer_phone:input.phone,customer_email:input.email,billing_period_days:30})),
  createCheckout:vi.fn(async()=>({checkout_url:'https://example.org/checkout'})),
} }));
import billingRoutes from '../src/routes/billing.routes.js';

describe('checkout rate limit', () => {
  let server:Server; let base:string;
  beforeAll(async()=>{
    process.env.BILLING_INTERNAL_SECRET='local-checkout-test-secret';
    const app=express();app.use(express.json());app.use('/billing',billingRoutes);
    server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
    base=`http://127.0.0.1:${(server.address() as any).port}/billing/checkout`;
  });
  afterAll(()=>{server.close();delete process.env.BILLING_INTERNAL_SECRET;});
  it('limits each phone separately even when requests share an IP address',async()=>{
    async function request(phone:string) {
      return fetch(base,{method:'POST',headers:{'content-type':'application/json','x-torrinco-billing-token':'local-checkout-test-secret'},body:JSON.stringify({idempotencyKey:'b19e6e5c-267f-455c-bc20-1a3066f65a1a',billingPeriod:'monthly',name:'Pessoa Teste',email:'test@example.org',phone})});
    }
    for(let i=0;i<10;i++) expect((await request('5511999990000')).status).toBe(200);
    expect((await request('5511999990000')).status).toBe(429);
    expect((await request('5511999990001')).status).toBe(200);
  });
});
