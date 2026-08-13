import { WebhooksController } from './webhooks.controller';
import { PaymentMethod } from './entities/payment.entity';

// اختبار وحدة مركّز — بيثبت إصلاح بَقّة P0-8 (مراجعة أمان شاملة 2026-08-13، docs/12):
// الكنترولر كان بيرجع 200 دايمًا حتى لو finalizeGatewayWebhook رمى استثناء داخلي غير متوقّع
// (DB واقع مثلاً)، فيكذب على بوابة الدفع إن الحدث اتستلم بنجاح رغم إن الدفعة فضلت غير متسوّاة.
describe('WebhooksController — لا يبتلع أخطاء داخلية غير متوقّعة كـ200 كاذب (regression P0-8)', () => {
  const gatewayResult = {
    signatureValid: true,
    externalEventId: 'evt-1',
    eventType: 'TRANSACTION',
    paymentId: 'payment-1',
    succeeded: true,
    amountCents: 1000,
    gatewayTransactionId: 'gw-1',
    failureReason: null,
  };

  it('حمولة غير قابلة للتحليل (verifyAndParseWebhook بترمي): بيرجع 200 (تجاهل واعي)', async () => {
    const paymentGateway = {
      providerName: 'paymob',
      verifyAndParseWebhook: jest.fn(() => {
        throw new Error('حمولة غير صالحة');
      }),
    };
    const paymentsService = { finalizeGatewayWebhook: jest.fn() };
    const controller = new WebhooksController(paymentsService as never, paymentGateway as never, {} as never);

    const result = await controller.handlePaymobWebhook({}, undefined);
    expect(result).toEqual({ received: true });
    expect(paymentsService.finalizeGatewayWebhook).not.toHaveBeenCalled();
  });

  it('finalizeGatewayWebhook بترمي خطأ داخلي غير متوقّع: الكنترولر يسيبه يتصاعد (5xx حقيقي) — كان الثغرة', async () => {
    const paymentGateway = {
      providerName: 'paymob',
      verifyAndParseWebhook: jest.fn(() => gatewayResult),
    };
    const internalError = new Error('DB connection lost');
    const paymentsService = { finalizeGatewayWebhook: jest.fn().mockRejectedValue(internalError) };
    const controller = new WebhooksController(paymentsService as never, paymentGateway as never, {} as never);

    await expect(controller.handlePaymobWebhook({}, 'hmac-value')).rejects.toThrow('DB connection lost');
    expect(paymentsService.finalizeGatewayWebhook).toHaveBeenCalledWith(
      gatewayResult.externalEventId,
      gatewayResult.eventType,
      'paymob',
      {},
      gatewayResult.signatureValid,
      gatewayResult.paymentId,
      gatewayResult.succeeded,
      gatewayResult.failureReason,
      gatewayResult.gatewayTransactionId,
      PaymentMethod.CARD,
      gatewayResult.amountCents,
    );
  });

  it('finalizeGatewayWebhook تعدّي عادي (قرار واعي، مفيش throw): بيرجع 200 زي المتوقع', async () => {
    const paymentGateway = {
      providerName: 'paymob',
      verifyAndParseWebhook: jest.fn(() => gatewayResult),
    };
    const paymentsService = { finalizeGatewayWebhook: jest.fn().mockResolvedValue(undefined) };
    const controller = new WebhooksController(paymentsService as never, paymentGateway as never, {} as never);

    const result = await controller.handlePaymobWebhook({}, 'hmac-value');
    expect(result).toEqual({ received: true });
  });
});
