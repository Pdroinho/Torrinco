import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { formatInstantDateLong } from '../lib/local-date';
import { formatTaxId, validTaxId } from '../lib/tax-id';

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
  return <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
    <header><h1 className="text-3xl font-bold">Plano e assinatura</h1><p className="mt-1 text-gray-500">Acompanhe seu acesso e gerencie a cobrança.</p></header>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
    {!data.access.allowed && <p className="rounded-xl bg-amber-50 p-4 text-amber-900">Seu acesso está bloqueado. Assine para continuar.</p>}
    {data.access.allowed && !hasRecurring && daysRemaining !== null && daysRemaining <= 3 && <p className="rounded-xl bg-amber-50 p-4 text-amber-900">Seu acesso termina em {formatDate(periodEnd)}. Renove por Pix abaixo para continuar usando o Torrinco.</p>}
    <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-dark-card sm:p-6">
      <span className="text-sm uppercase text-gray-500">Plano atual</span>
      <h2 className="text-2xl font-bold capitalize text-torrinco-700">{data.plan.name} · {data.status}</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div>Usuários: <strong>{data.usage.users.current} de {data.usage.users.maximum}</strong></div>
        <div>Cartões: <strong>{data.usage.cards.current} de {data.usage.cards.maximum}</strong></div>
        <div>Válido até: <strong>{formatDate(periodEnd)}</strong></div>
      </div>
      {data.access.inGracePeriod && <p className="mt-3 text-amber-700">Prazo de tolerância até {formatDate(data.dates.gracePeriodEndsAt)}.</p>}
    </section>
    <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-dark-card sm:p-6">
      <h2 className="text-xl font-bold">Pagamento e renovação</h2>
      {hasRecurring ? <><p className="mt-2">Próximo ciclo: {formatDate(data.recurring!.currentPeriodEndsAt)}.</p><button disabled={busy} onClick={cancel} className="mt-4 rounded-lg border px-4 py-2 disabled:opacity-50">Cancelar próximas cobranças</button></>
        : data.recurring?.status === 'cancelled' && data.access.allowed ? <p className="mt-2">Renovação cancelada. Seu acesso continua até {formatDate(data.recurring.currentPeriodEndsAt)}.</p>
        : <div className="mt-4 max-w-md space-y-3">
          <label className="block text-sm">E-mail para a cobrança<input required type="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label>
          <label className="block text-sm">CPF ou CNPJ<input required inputMode="numeric" autoComplete="off" value={taxId} onChange={event => setTaxId(formatTaxId(event.target.value))} className="mt-1 w-full rounded-lg border p-2" /></label>
          <fieldset className="flex flex-wrap gap-4"><legend className="mb-2 text-sm font-semibold">Forma de pagamento</legend>
            <label className="flex items-center gap-2"><input type="radio" name="paymentMethod" checked={paymentMethod==='card'} onChange={()=>setPaymentMethod('card')} /> Cartão de crédito</label>
            <label className="flex items-center gap-2"><input type="radio" name="paymentMethod" checked={paymentMethod==='pix'} onChange={()=>setPaymentMethod('pix')} /> Pix · 10% de desconto</label>
          </fieldset>
          {data.availablePlans.map(plan => <div key={plan.id} className="space-y-2">
            <button disabled={busy || !email.includes('@')} onClick={() => buy('monthly')} className="w-full rounded-lg bg-torrinco-700 px-4 py-3 text-white disabled:opacity-50">{paymentMethod==='card'?'Assinar mensal':'Pagar um mês'} · {money(checkoutPrice(plan.price_monthly,paymentMethod))}</button>
            <button disabled={busy || !email.includes('@')} onClick={() => buy('yearly')} className="w-full rounded-lg border px-4 py-3 disabled:opacity-50">{paymentMethod==='card'?'Assinar anual':'Pagar um ano'} · {money(checkoutPrice(plan.price_yearly,paymentMethod))}</button>
          </div>)}
          <p className="text-sm text-gray-500">{paymentMethod==='card'?'Assinatura com renovação automática no cartão. Cancele quando quiser.':'Pagamento por Pix. Para renovar, faça um novo pagamento ao fim do período.'}</p>
        </div>}
    </section>
  </main>;
}
