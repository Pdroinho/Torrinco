import { prisma } from '../lib/prisma.js';

/**
 * Cria os planos padrão do Torrinco.
 * Idempotente: se já existirem, apenas atualiza.
 *
 * Rodar após migrations: npx tsx scripts/seed-plans.ts
 */
async function main() {
  const plans = [
    {
      name: 'individual',
      max_users: 1,
      max_cards: 5,
      price_monthly: 19.90,
      price_yearly: 119.88,
      features: { calendar: true, ai: true, import: true, installments: true },
      status: 'active'
    },
    {
      name: 'family',
      max_users: 4,
      max_cards: 10,
      price_monthly: 34.90,
      price_yearly: 349.00,
      features: { calendar: true, ai: true, import: true, installments: true, shared_cards: true },
      status: 'hidden'
    },
    {
      name: 'pro',
      max_users: 1,
      max_cards: 20,
      price_monthly: 39.90,
      price_yearly: 399.00,
      features: { calendar: true, ai: true, import: true, installments: true, advanced_reports: true, api_access: true },
      status: 'hidden'
    },
    {
      name: 'free',
      max_users: 1,
      max_cards: 2,
      price_monthly: 0,
      price_yearly: 0,
      features: { calendar: false, ai: true, import: false, installments: false },
      status: 'hidden'
    }
  ];

  for (const plan of plans) {
    const existing = await prisma.plans.findUnique({ where: { name: plan.name } });
    if (existing) {
      await prisma.plans.update({
        where: { name: plan.name },
        data: plan
      });
      console.log(`✅ Plano "${plan.name}" atualizado (id: ${existing.id})`);
    } else {
      const created = await prisma.plans.create({ data: plan });
      console.log(`✅ Plano "${plan.name}" criado (id: ${created.id})`);
    }
  }

  console.log('\n📋 Planos disponíveis:');
  const all = await prisma.plans.findMany({ select: { id: true, name: true, max_users: true, price_monthly: true } });
  all.forEach(p => console.log(`  - [${p.id}] ${p.name}: ${p.max_users} usuário(s), R$ ${p.price_monthly}/mês`));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
