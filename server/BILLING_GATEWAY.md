# Cobrança recorrente AbacatePay v2

O checkout da landing chama `POST /api/billing/checkout` de servidor para servidor, com `BILLING_INTERNAL_SECRET`. O app autenticado usa `POST /api/subscription/checkout`. Ambos criam um pedido idempotente com o preço de `plans`, selecionam um produto recorrente por ciclo e validam o valor devolvido pelo gateway. O navegador só recebe a URL hospedada. A chave de produção fica exclusivamente no backend.

O webhook `POST /api/billing/webhook/abacatepay` recebe corpo bruto antes de `express.json()`, confere `webhookSecret` e HMAC, deduplica por `log_...` e localiza o pedido por checkout `bill_...`. Somente `subscription.completed` com valor e referência esperados ativa/provisiona a conta. `subscription.renewed` estende o período; falha, cancelamento e reembolso alteram acesso conforme as regras do serviço. O retorno `/obrigado` não libera conta.

## Configuração de produção

1. O preço anual escolhido é R$ 119,88. O seed e a landing estão alinhados; atualize o registro `plans` no banco de produção, que ainda estava em R$ 199,00 na auditoria.
2. Crie dois produtos v2 com preço em centavos: `cycle: MONTHLY` e `cycle: ANNUALLY`. Registre seus IDs em `ABACATEPAY_MONTHLY_PRODUCT_ID` e `ABACATEPAY_YEARLY_PRODUCT_ID`.
3. Configure no servidor `ABACATEPAY_API_KEY`, os IDs dos produtos, `ABACATEPAY_WEBHOOK_SECRET`, `BILLING_INTERNAL_SECRET`, `PUBLIC_APP_URL` e `PUBLIC_LANDING_URL`. O Compose do Coolify lista os nomes; os valores devem ficar apenas nos secrets do recurso.
4. Crie webhook v2 para `subscription.completed`, `subscription.renewed`, `subscription.payment_failed`, `subscription.cancelled` e `checkout.refunded`, apontando para a URL HTTPS pública da API em `/api/billing/webhook/abacatepay`. Use o mesmo secret do passo anterior.
5. Configure `BILLING_API_URL` e o mesmo `BILLING_INTERNAL_SECRET` na landing. Remova qualquer webhook antigo que aponte para a rota legada da landing.
6. Teste checkout, pagamento, provisionamento, renovação, falha e cancelamento em dev mode antes de habilitar a chave de produção. Confira um checkout real de baixo valor somente com autorização operacional apropriada.

O cancelamento no app interrompe cobranças futuras no gateway. O acesso já pago segue até `current_period_ends_at`; a reativação local de assinatura externa é bloqueada e exige novo checkout.

## Verificação local

```powershell
npx.cmd prisma generate
npm.cmd run build
$env:JWT_SECRET='local-test-secret-at-least-32-characters'; npm.cmd test
```

`FakeBillingProvider` continua restrito a testes. Dados completos do cartão não entram na aplicação.
