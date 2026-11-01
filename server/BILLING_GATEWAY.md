# Cobran?as por cart?o recorrente e Pix manual

No cart?o, o cliente contrata uma assinatura recorrente mensal ou anual. No Pix, paga uma cobran?a avulsa para cada per?odo. A landing chama `POST /api/billing/checkout` com o segredo interno; o app autenticado usa `POST /api/subscription/checkout`. O pre?o vem do banco e ? comparado com o valor do checkout hospedado.

O webhook recebe `checkout.completed` para Pix e `subscription.completed` para assinatura, confere o segredo e a assinatura, e valida o pedido antes de liberar o per?odo. O Pix pago antecipadamente estende o per?odo atual. A contrata??o no cart?o ? bloqueada enquanto houver per?odo pago por Pix, para evitar sobreposi??o de cobran?as. O cliente recebe avisos pelo WhatsApp; `BILLING_REMINDERS_ENABLED=true` habilita o agendador espec?fico de cobran?a. Execute-o em apenas uma inst?ncia. O retorno `/obrigado` n?o libera a conta.

Para configurar o gateway, crie e verifique os produtos avulsos com `node scripts/setup-pix-products.mjs --create`, configure `ABACATEPAY_PIX_MONTHLY_PRODUCT_ID`, `ABACATEPAY_PIX_YEARLY_PRODUCT_ID`, `ABACATEPAY_MONTHLY_PRODUCT_ID` e `ABACATEPAY_YEARLY_PRODUCT_ID` junto aos demais segredos documentados em `.env.example`, e registre `checkout.completed`, `subscription.completed`, `subscription.renewed`, `subscription.payment_failed`, `subscription.cancelled` e `checkout.refunded` no endpoint HTTPS de webhook. A integra??o tamb?m mant?m suporte para os eventos das assinaturas existentes.

A gera??o de cobran?a Pix em produ??o e a ativa??o simulada em banco MySQL isolado foram testadas. Falta um pagamento real para validar ponta a ponta o webhook da AbacatePay, o primeiro acesso e a entrega de avisos; valide tamb?m o reembolso antes de anunciar o servi?o.

Na VPS compartilhada, mantenha `SCHEDULER_ENABLED=false` na inst?ncia paralela e habilite somente o agendador de cobran?a nela. O c?digo da landing ? mantido separadamente.

Para evitar duas assinaturas, pedidos no cart?o t?m uma reserva ?nica por telefone. Uma tentativa que falhou ap?s o in?cio da cria??o fica em revis?o; n?o limpe a reserva at? conferir no gateway se existe checkout pag?vel.
