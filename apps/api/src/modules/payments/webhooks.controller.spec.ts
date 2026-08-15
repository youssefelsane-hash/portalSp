import { WebhooksController } from './webhooks.controller';
import { PaymentMethod } from './entities/payment.entity';

// اختبار وحدة مركّز — بيثبت إصلاح بَقّة P0-8 (مراجعة أمان شاملة 2026-08-13، docs/12):
// الكنترولر كان بيرجع 200 دايمًا حتى لو finalizeGatewayWebhook رمى استثناء داخلي غير متوقّع
// (DB واقع مثلاً)، فيكذب على بوابة الدفع إن الحدث اتستلم بنجاح رغم إن الدفعة فضلت غير متسوّاة.
// اتحدّث (ADR-0013) عشان يبني WebhooksController عبر PaymentProviderRegistry.getByProviderKey()
// بدل حقن PAYMENT_GATEWAY مباشرة — الكنترولر نفسه (منطق try/catch والتصعيد) بلا تغيير.
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

  function makeRegistry(verifyWebhook: jest.Mock) {
    // verifyCardSaveWebhook بترجع null دايمًا هنا — مفيش حدث حفظ كارت في اختبارات الملف ده،
    // كل الحمولات TRANSACTION عادية (docs/08 §21).
    const paymobProvider = { verifyWebhook, verifyCardSaveWebhook: jest.fn(() => null) };
    return { getByProviderKey: jest.fn(() => paymobProvider) };
  }

  it('حمولة غير قابلة للتحليل (verifyWebhook بترمي): بيرجع 200 (تجاهل واعي)', async () => {
    const verifyWebhook = jest.fn(() => {
      throw new Error('حمولة غير صالحة');
    });
    const paymentsService = { finalizeGatewayWebhook: jest.fn() };
    const controller = new WebhooksController(paymentsService as never, makeRegistry(verifyWebhook) as never);

    const result = await controller.handlePaymobWebhook({}, undefined);
    expect(result).toEqual({ received: true });
    expect(paymentsService.finalizeGatewayWebhook).not.toHaveBeenCalled();
  });

  it('finalizeGatewayWebhook بترمي خطأ داخلي غير متوقّع: الكنترولر يسيبه يتصاعد (5xx حقيقي) — كان الثغرة', async () => {
    const verifyWebhook = jest.fn(() => gatewayResult);
    const internalError = new Error('DB connection lost');
    const paymentsService = { finalizeGatewayWebhook: jest.fn().mockRejectedValue(internalError) };
    const controller = new WebhooksController(paymentsService as never, makeRegistry(verifyWebhook) as never);

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
    const verifyWebhook = jest.fn(() => gatewayResult);
    const paymentsService = { finalizeGatewayWebhook: jest.fn().mockResolvedValue(undefined) };
    const controller = new WebhooksController(paymentsService as never, makeRegistry(verifyWebhook) as never);

    const result = await controller.handlePaymobWebhook({}, 'hmac-value');
    expect(result).toEqual({ received: true });
  });
});
