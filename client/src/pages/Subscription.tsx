import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { formatInstantDateLong } from '../lib/local-date';
import { formatTaxId, validTaxId } from '../lib/tax-id';
import { ArrowUpRight, CalendarDays, CreditCard, ShieldCheck, Sparkles, Users, WalletCards } from 'lucide-react';

type Overview = {
  status: string;
  access: { allowed: boolean; inGracePeriod: boolean };
  plan: { name: string; features: Record<string, boolean> };
  usage: { users: { current: number; maximum: number }; cards: { current: number; maximum: number } };
  dates: { trialEndsAt: string | null; currentPeriodEndsAt: string | null; gracePeriodEndsAt: string | null };
  availablePlans: Array<{ id: number; name: string; price_monthly: string | number | null; price_yearly: string | number | null }>;
  recurring: { status: string; currentPeriodEndsAt: string | null } | null;
};

const formatDate = (date: string | null) => date ? formatInstantDateLong(date) : 'Não definido';
const money = (value: string | number | null) => value == null ? 'Indisponível' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
const checkoutPrice = (value: string | number | null, method: 'card'|'pix') => value == null || method === 'card' ? value : Math.round(Math.round(Number(value) * 100) * 0.9) / 100;

export function Subscription() {
  const [data, setData] = useState<Overview | null>(null);
  const [email, setEmail] = useState('');
  const [taxId, setTaxId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'card'|'pix'>('card');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const keys = useRef<Record<string, string>>({});

  useEffect(() => { api.get('/subscription').then(response => setData(response.data)).catch(() => setError('Não foi possível carregar a assinatura.')); }, []);

  async function buy(period: 'monthly' | 'yearly') {
    if (!validTaxId(taxId)) { setError('Informe um CPF ou CNPJ válido.'); return; }
    setBusy(true); setError('');
    try {
      const key = `${period}:${paymentMethod}:${email.trim().toLowerCase()}:${taxId.replace(/\D/g, '')}`;
      keys.current[key] ??= crypto.randomUUID();
      const response = await api.post('/subscription/checkout', { billingPeriod: period, paymentMethod, email, taxId, idempotencyKey: keys.current[key] });
      window.location.assign(response.data.url);
    } catch (err: any) { setError(err?.response?.status === 409 && typeof err.response.data?.error === 'string' ? err.response.data.error : 'Não foi possível iniciar o pagamento. Confira o e-mail e tente novamente.'); setBusy(false); }
  }

  async function cancel() {
    if (!window.confirm('Cancelar as próximas cobranças? Seu acesso pago continua até o fim do período atual.')) return;
    setBusy(true); setError('');
    try { await api.post('/subscription/cancel'); setData((await api.get('/subscription')).data); }
    catch { setError('Não foi possível cancelar agora. Tente novamente ou contate o suporte.'); }
    finally { setBusy(false); }
  }

  if (!data) return <div className="p-6">{error || 'Carregando plano...'}</div>;
  const periodEnd = data.status === 'trial' ? data.dates.trialEndsAt : data.dates.currentPeriodEndsAt;
  const hasRecurring = data.recurring?.status === 'active' || data.recurring?.status === 'past_due';
  const daysRemaining = periodEnd ? Math.ceil((new Date(periodEnd).getTime() - Date.now()) / 86_400_000) : null;
  const statusLabel: Record<string,string> = { active:'Ativo', trial:'Em teste', expired:'Expirado', past_due:'Pagamento pendente', cancelled:'Cancelado', suspended:'Suspenso' };
  return <main className="mx-auto max-w-6xl space-y-6 p-4 text-slate-900 dark:text-slate-100 sm:p-6 lg:p-8">
    <header><p className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Sua conta</p><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Plano e assinatura</h1><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Seu acesso, os detalhes do plano e a renovação em um só lugar.</p></header>
    {error && <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {!data.access.allowed && <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">Seu acesso está bloqueado. Escolha um plano abaixo para continuar.</p>}
    {data.access.allowed && !hasRecurring && daysRemaining !== null && daysRemaining <= 3 && <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">Seu acesso termina em {formatDate(periodEnd)}. Renove por Pix abaixo para continuar usando o Torrinco.</p>}
    <section className="overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-sm dark:border-emerald-900 dark:bg-dark-card">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-emerald-50 px-5 py-5 dark:bg-emerald-950/40 sm:px-7">
        <div><p className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Seu plano</p><h2 className="mt-1 text-2xl font-bold capitalize tracking-tight">{data.plan.name}</h2></div>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${data.access.allowed ? 'bg-white text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100' : 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100'}`}><span className={`h-2 w-2 rounded-full ${data.access.allowed ? 'bg-emerald-500' : 'bg-amber-500'}`} />{statusLabel[data.status] ?? data.status}</span>
      </div>
      <div className="grid gap-5 px-5 py-6 sm:grid-cols-3 sm:px-7">
        <div className="flex items-start gap-3"><span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><CalendarDays size={19}/></span><div><p className="text-xs text-slate-500 dark:text-slate-400">{data.status==='trial'?'Teste até':'Acesso até'}</p><p className="mt-1 text-sm font-semibold">{formatDate(periodEnd)}</p></div></div>
        <div className="flex items-start gap-3"><span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><Users size={19}/></span><div><p className="text-xs text-slate-500 dark:text-slate-400">Usuários</p><p className="mt-1 text-sm font-semibold">{data.usage.users.current} de {data.usage.users.maximum}</p></div></div>
        <div className="flex items-start gap-3"><span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><WalletCards size={19}/></span><div><p className="text-xs text-slate-500 dark:text-slate-400">Cartões cadastrados</p><p className="mt-1 text-sm font-semibold">{data.usage.cards.current} de {data.usage.cards.maximum}</p></div></div>
      </div>
      {data.access.inGracePeriod && <p className="px-5 pb-5 text-sm text-amber-700 dark:text-amber-300 sm:px-7">Prazo de tolerância até {formatDate(data.dates.gracePeriodEndsAt)}.</p>}
    </section>
    <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-dark-card sm:p-7">
      <div className="flex items-start gap-3"><span className="rounded-xl bg-yellow-100 p-2.5 text-emerald-900 dark:bg-yellow-900 dark:text-yellow-100"><CreditCard size={20}/></span><div><h2 className="text-xl font-bold tracking-tight">Pagamento e renovação</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Escolha como manter seu acesso em dia.</p></div></div>
      {hasRecurring ? <div className="mt-6 rounded-2xl bg-emerald-50 p-5 dark:bg-emerald-950/40"><p className="font-semibold">Renovação automática ativa</p><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Próximo ciclo: {formatDate(data.recurring!.currentPeriodEndsAt)}.</p><button disabled={busy} onClick={cancel} className="mt-4 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700">Cancelar próximas cobranças</button></div>
        : data.recurring?.status === 'cancelled' && data.access.allowed ? <p className="mt-6 rounded-2xl bg-slate-50 p-5 text-sm dark:bg-slate-800">Renovação cancelada. Seu acesso continua até {formatDate(data.recurring.currentPeriodEndsAt)}.</p>
        : <div className="mt-6 space-y-6">
          <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="mb-3 text-sm font-semibold">Como prefere pagar?</legend>
            <label className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-4 transition-colors ${paymentMethod==='card'?'border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40':'border-slate-200 dark:border-slate-700'}`}><input className="accent-emerald-700" type="radio" name="paymentMethod" checked={paymentMethod==='card'} onChange={()=>setPaymentMethod('card')} /><span><strong className="block text-sm">Cartão de crédito</strong><small className="mt-1 block text-slate-500 dark:text-slate-400">Renovação automática</small></span></label>
            <label className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-4 transition-colors ${paymentMethod==='pix'?'border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40':'border-slate-200 dark:border-slate-700'}`}><input className="accent-emerald-700" type="radio" name="paymentMethod" checked={paymentMethod==='pix'} onChange={()=>setPaymentMethod('pix')} /><span className="flex-1"><strong className="block text-sm">Pix</strong><small className="mt-1 block text-slate-500 dark:text-slate-400">Renovação manual</small></span><span className="rounded-full bg-yellow-300 px-2.5 py-1 text-xs font-bold text-emerald-950">10% off</span></label>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold">E-mail para a cobrança<input required type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="voce@email.com" className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-normal outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 dark:border-slate-600 dark:bg-slate-900" /></label><label className="block text-sm font-semibold">CPF ou CNPJ<input required inputMode="numeric" autoComplete="off" value={taxId} onChange={event => setTaxId(formatTaxId(event.target.value))} placeholder="000.000.000-00" className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-normal outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 dark:border-slate-600 dark:bg-slate-900" /></label></div>
          {data.availablePlans.map(plan => <div key={plan.id} className="grid gap-3 sm:grid-cols-2">
            <button disabled={busy || !email.includes('@') || !validTaxId(taxId)} onClick={() => buy('monthly')} className="flex min-h-20 items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-900 dark:bg-emerald-950/40 dark:hover:bg-emerald-900"><span><strong className="block text-sm">{paymentMethod==='card'?'Assinar mensal':'Renovar por 1 mês'}</strong><span className="mt-1 block text-lg font-bold">{money(checkoutPrice(plan.price_monthly,paymentMethod))}</span></span><ArrowUpRight size={19}/></button>
            <button disabled={busy || !email.includes('@') || !validTaxId(taxId)} onClick={() => buy('yearly')} className="flex min-h-20 items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-900 dark:bg-emerald-950/40 dark:hover:bg-emerald-900"><span><strong className="block text-sm">{paymentMethod==='card'?'Assinar anual':'Renovar por 1 ano'}</strong><span className="mt-1 block text-lg font-bold">{money(checkoutPrice(plan.price_yearly,paymentMethod))}</span></span><ArrowUpRight size={19}/></button>
          </div>)}
          <p className="flex items-start gap-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400"><ShieldCheck size={17} className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-400" />{paymentMethod==='card'?'Pagamento pela AbacatePay. A assinatura renova automaticamente no cartão; você pode cancelar as próximas cobranças.':'Pagamento pela AbacatePay. Para renovar por Pix, faça um novo pagamento ao fim do período.'}</p>
        </div>}
    </section>
    <p className="flex items-center gap-2 px-1 text-xs text-slate-500 dark:text-slate-400"><Sparkles size={15} className="text-emerald-600" /> Uma conversa de cada vez. O Torrinco cuida da organização.</p>
  </main>;
}
