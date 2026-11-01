import cron from 'node-cron';
import { prisma } from '../lib/prisma.js';
import { EvolutionService } from '../services/evolution.service.js';
import { dayExecutionKey, runIdempotentJob } from '../services/job-runtime.service.js';

// Billing reminders run separately from the legacy scheduler in production.
export function startBillingReminders() {
  cron.schedule('15 * * * *', () => {
    const hourKey = new Date().toISOString().slice(0, 13);
    void runIdempotentJob('pix_renewal_reminders', hourKey, sendBillingReminders, 10 * 60_000).catch(() => undefined);
  });
}

export async function sendBillingReminders(now = new Date()) {
  const day = dayExecutionKey(now);
  const start = new Date(now.getTime() - 4 * 86_400_000);
  const end = new Date(now.getTime() + 4 * 86_400_000);
  const accounts = await prisma.accounts.findMany({
    where: { status: 'active', access_status:'enabled', current_period_ends_at: { gte: start, lte: end }, billing_subscriptions: {
      some: { provider: 'abacatepay', external_subscription_id: { startsWith: 'order:' } },
      none: { provider: 'abacatepay', external_subscription_id: { startsWith: 'subs_' }, status: { in: ['active','past_due'] } },
    } },
    select: { id:true, current_period_ends_at:true, users:{where:{role:'owner',status:'active'},select:{id:true,phone_number:true},take:1} },
  });
  let sent = 0;
  for (const account of accounts) {
    const owner = account.users[0]; const due = account.current_period_ends_at;
    if (!owner || !due) continue;
    const days = Math.round((new Date(day + 'T12:00:00Z').getTime() - new Date(dayExecutionKey(due) + 'T12:00:00Z').getTime()) / 86_400_000);
    if (![-3, -1, 0, 1, 3].includes(days)) continue;
    const occurrence = `${due.toISOString()}:${day}`;
    const date = due.toLocaleDateString('pt-BR', {timeZone:'America/Sao_Paulo'});
    const message = `Seu acesso ao Torrinco ${days > 0 ? 'venceu' : 'vence'} em ${date}. Para renovar por Pix, abra ${process.env.PUBLIC_APP_URL ?? 'https://app.torrinco.com.br'}/subscription`;
    let delivery;
    try { delivery = await prisma.reminder_deliveries.create({data:{source_type:'billing_pix',source_id:String(account.id),occurrence_key:occurrence,account_id:account.id,user_id:owner.id,destination:owner.phone_number,message,status:'billing_retry'}}); }
    catch (error:any) { if(error?.code !== 'P2002') throw error; delivery=await prisma.reminder_deliveries.findUnique({where:{source_type_source_id_occurrence_key:{source_type:'billing_pix',source_id:String(account.id),occurrence_key:occurrence}}}); }
    if (!delivery || delivery.attempts >= 5) continue;
    const claimed=await prisma.reminder_deliveries.updateMany({where:{id:delivery.id,OR:[{status:'billing_retry'},{status:'billing_sending',locked_until:{lt:now}}]},data:{status:'billing_sending',locked_until:new Date(now.getTime()+10*60_000),attempts:{increment:1}}});
    if (!claimed.count) continue;
    const result = await EvolutionService.sendText(owner.phone_number,message);
    await prisma.reminder_deliveries.update({where:{id:delivery.id},data:result?{status:'sent',sent_at:new Date(),locked_until:null}:{status:'billing_retry',last_error:'WhatsApp delivery failed',locked_until:null}});
    if(result) sent++;
  }
  return {sent};
}
