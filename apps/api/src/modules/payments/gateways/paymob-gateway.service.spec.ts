import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PaymobGatewayService } from './paymob-gateway.service';

// ConfigService وهمي بسيط بيرجّع من map ثابت — نفس فلسفة FakeRepository في auth.service.spec.ts،
// كفاية عشان نختبر منطق PaymobGatewayService لوحده من غير NestJS testing module كامل.
function fakeConfig(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const CONFIGURED_ENV = {
  'payments.paymob.baseUrl': 'https://accept.paymob.com',
  'payments.paymob.apiKey': 'test-api-key',
  'payments.paymob.integrationIdCard': '12345',
  'payments.paymob.iframeId': '67890',
  'payments.paymob.hmacSecret': 'super-secret-hmac-key',
};

function buildTransactionObj(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 987654321,
    amount_cents: 30000,
    success: true,
    pending: false,
    error_occured: false,
    is_refunded: false,
    is_voided: false,
    is_capture: false,
    is_standalone_payment: true,
    is_auth: false,
    is_3d_secure: true,
    has_parent_transaction: false,
    integration_id: 12345,
    owner: 555,
    created_at: '2026-08-08T12:00:00.000000',
    currency: 'EGP',
    order: { id: 111222333, merchant_order_id: 'payment-uuid-abc-123' },
    source_data: { pan: '1234', sub_type: 'MasterCard', type: 'card' },
    ...overrides,
  };
}

// نفس خوارزمية الحساب الموثّقة في Paymob HMAC Calculation — منسوخة هنا مستقلة عن كود
// الخدمة نفسها عشان الاختبار يثبت إن التنفيذ الحقيقي (computeHmac الخاصة) بيتوافق مع
// المواصفة الرسمية، مش بس متّسق مع نفسه.
function referenceHmac(obj: ReturnType<typeof buildTransactionObj>, secret: string): string {
  const fields = [
    String(obj.amount_cents),
    obj.created_at,
    obj.currency,
    String(obj.error_occured),
    String(obj.has_parent_transaction),
    String(obj.id),
    String(obj.integration_id),
    String(obj.is_3d_secure),
    String(obj.is_auth),
    String(obj.is_capture),
    String(obj.is_refunded),
    String(obj.is_standalone_payment),
    String(obj.is_voided),
    String(obj.order.id),
    String(obj.owner),
    String(obj.pending),
    obj.source_data?.pan ?? '',
    obj.source_data?.sub_type ?? '',
    obj.source_data?.type ?? '',
    String(obj.success),
  ].join('');
  return createHmac('sha512', secret).update(fields).digest('hex');
}

describe('PaymobGatewayService', () => {
  describe('isConfigured', () => {
    it('true لما كل env vars الأربعة موجودة', () => {
      const gateway = new PaymobGatewayService(fakeConfig(CONFIGURED_ENV));
      expect(gateway.isConfigured).toBe(true);
    });

    it('false لو ولا حتى واحدة من الأربعة ناقصة', () => {
      const { 'payments.paymob.hmacSecret': _omit, ...rest } = CONFIGURED_ENV;
      const gateway = new PaymobGatewayService(fakeConfig(rest));
      expect(gateway.isConfigured).toBe(false);
    });
  });

  describe('verifyAndParseWebhook', () => {
    it('يقبل حمولة صحيحة بتوقيع HMAC صح، ويستخرج كل الحقول صح', () => {
      const gateway = new PaymobGatewayService(fakeConfig(CONFIGURED_ENV));
      const obj = buildTransactionObj();
      const hmac = referenceHmac(obj, CONFIGURED_ENV['payments.paymob.hmacSecret']);

      const result = gateway.verifyAndParseWebhook({ type: 'TRANSACTION', obj }, hmac);

      expect(result.signatureValid).toBe(true);
      expect(result.succeeded).toBe(true);
      expect(result.paymentId).toBe('payment-uuid-abc-123');
      expect(result.amountCents).toBe(30000);
      expect(result.gatewayTransactionId).toBe('987654321');
      expect(result.failureReason).toBeNull();
    });

    it('يرفض لو الـ HMAC غلط', () => {
      const gateway = new PaymobGatewayService(fakeConfig(CONFIGURED_ENV));
      const obj = buildTransactionObj();

      const result = gateway.verifyAndParseWebhook({ type: 'TRANSACTION', obj }, 'a'.repeat(128));

      expect(result.signatureValid).toBe(false);
      expect(result.failureReason).toContain('توقيع');
    });

    it('يرفض لو أي حقل اتلاعب فيه بعد حساب الـ HMAC (amount_cents هنا) — يثبت إن التوقيع فعلاً بيغطي المبلغ', () => {
      const gateway = new PaymobGatewayService(fakeConfig(CONFIGURED_ENV));
      const obj = buildTransactionObj();
      const hmac = referenceHmac(obj, CONFIGURED_ENV['payments.paymob.hmacSecret']);

      // نفس التوقيع القديم لكن المبلغ اتغيّر بعد الحساب — محاكاة محاولة تلاعب بمبلغ الدفع
      const tamperedObj = { ...obj, amount_cents: 999999 };
      const result = gateway.verifyAndParseWebhook({ type: 'TRANSACTION', obj: tamperedObj }, hmac);

      expect(result.signatureValid).toBe(false);
    });

    it('يرفض لو الـ secret غلط (بوابة متظبطة بمفتاح مختلف)', () => {
      const gateway = new PaymobGatewayService(fakeConfig(CONFIGURED_ENV));
      const obj = buildTransactionObj();
      const hmacWithWrongSecret = referenceHmac(obj, 'wrong-secret');

      const result = gateway.verifyAndParseWebhook({ type: 'TRANSACTION', obj }, hmacWithWrongSecret);

      expect(result.signatureValid).toBe(false);
    });

    it('يرفض لو مفيش hmac خالص في الطلب', () => {
      const gateway = new PaymobGatewayService(fakeConfig(CONFIGURED_ENV));
      const obj = buildTransactionObj();

      const result = gateway.verifyAndParseWebhook({ type: 'TRANSACTION', obj }, undefined);

      expect(result.signatureValid).toBe(false);
    });

    it('يرفض فوراً لو البوابة مش مُعدّة أصلاً (مفيش hmacSecret)', () => {
      const { 'payments.paymob.hmacSecret': _omit, ...rest } = CONFIGURED_ENV;
      const gateway = new PaymobGatewayService(fakeConfig(rest));
      const obj = buildTransactionObj();

      const result = gateway.verifyAndParseWebhook({ type: 'TRANSACTION', obj }, 'anything');

      expect(result.signatureValid).toBe(false);
      expect(result.failureReason).toContain('مُعدّة');
    });

    it('succeeded=false لو success=false في الحمولة حتى لو التوقيع صح', () => {
      const gateway = new PaymobGatewayService(fakeConfig(CONFIGURED_ENV));
      const obj = buildTransactionObj({ success: false, data: { message: 'Insufficient funds' } });
      const hmac = referenceHmac(obj, CONFIGURED_ENV['payments.paymob.hmacSecret']);

      const result = gateway.verifyAndParseWebhook({ type: 'TRANSACTION', obj }, hmac);

      expect(result.signatureValid).toBe(true);
      expect(result.succeeded).toBe(false);
      expect(result.failureReason).toBe('Insufficient funds');
    });
  });

  describe('createCardPayment', () => {
    it('يرفض فوراً بخطأ واضح لو البوابة مش مُعدّة، من غير أي نداء شبكة', async () => {
      const gateway = new PaymobGatewayService(fakeConfig({}));
      await expect(
        gateway.createCardPayment({
          paymentId: 'p1',
          orderNumber: 'ORD-1',
          amountCents: 1000,
          currencyCode: 'EGP',
          customerFirstName: 'a',
          customerLastName: 'b',
          customerEmail: 'a@b.com',
          customerPhone: '+201000000000',
        }),
      ).rejects.toThrow();
    });
  });
});
