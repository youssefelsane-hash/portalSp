import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PaymobProvider } from './paymob-provider.service';

// ConfigService وهمي بسيط بيرجّع من map ثابت — نفس فلسفة FakeRepository في auth.service.spec.ts.
// اتحدّث (ADR-0013) عشان يختبر PaymobProvider (Intention API) بدل PaymobGatewayService المهجورة —
// منطق HMAC نفسه بالحرف (computeHmac منسوخ صفريًا من الكود القديم)، الفرق بس إعدادات isConfigured
// (secretKey/publicKey بدل apiKey/iframeId — الأخيرين بقوا مستخدَمين بس في مسار Transaction Inquiry
// القديم اللي لسه شغال جنب Intention API).
function fakeConfig(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const CONFIGURED_ENV = {
  'payments.paymob.baseUrl': 'https://accept.paymob.com',
  'payments.paymob.apiKey': 'test-api-key',
  'payments.paymob.secretKey': 'test-secret-key',
  'payments.paymob.publicKey': 'test-public-key',
  'payments.paymob.integrationIdCard': '12345',
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

// نفس خوارزمية الحساب الموثّقة في Paymob HMAC Calculation — منسوخة هنا مستقلة عن كود الخدمة
// نفسها عشان الاختبار يثبت إن التنفيذ الحقيقي (computeHmac الخاصة) بيتوافق مع المواصفة الرسمية.
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

describe('PaymobProvider', () => {
  describe('isConfigured', () => {
    it('true لما secretKey/publicKey/integrationIdCard/hmacSecret كلهم موجودين', () => {
      const provider = new PaymobProvider(fakeConfig(CONFIGURED_ENV));
      expect(provider.isConfigured).toBe(true);
    });

    it('false لو ولا حتى واحد من الأربعة ناقص', () => {
      const { 'payments.paymob.hmacSecret': _omit, ...rest } = CONFIGURED_ENV;
      const provider = new PaymobProvider(fakeConfig(rest));
      expect(provider.isConfigured).toBe(false);
    });
  });

  describe('verifyWebhook', () => {
    it('يقبل حمولة صحيحة بتوقيع HMAC صح، ويستخرج كل الحقول صح', () => {
      const provider = new PaymobProvider(fakeConfig(CONFIGURED_ENV));
      const obj = buildTransactionObj();
      const hmac = referenceHmac(obj, CONFIGURED_ENV['payments.paymob.hmacSecret']);

      const result = provider.verifyWebhook({ type: 'TRANSACTION', obj }, hmac);

      expect(result.signatureValid).toBe(true);
      expect(result.succeeded).toBe(true);
      expect(result.paymentId).toBe('payment-uuid-abc-123');
      expect(result.amountCents).toBe(30000);
      expect(result.gatewayTransactionId).toBe('987654321');
      expect(result.failureReason).toBeNull();
    });

    it('يرفض لو الـ HMAC غلط', () => {
      const provider = new PaymobProvider(fakeConfig(CONFIGURED_ENV));
      const obj = buildTransactionObj();

      const result = provider.verifyWebhook({ type: 'TRANSACTION', obj }, 'a'.repeat(128));

      expect(result.signatureValid).toBe(false);
      expect(result.failureReason).toContain('توقيع');
    });

    it('يرفض لو أي حقل اتلاعب فيه بعد حساب الـ HMAC (amount_cents هنا) — يثبت إن التوقيع فعلاً بيغطي المبلغ', () => {
      const provider = new PaymobProvider(fakeConfig(CONFIGURED_ENV));
      const obj = buildTransactionObj();
      const hmac = referenceHmac(obj, CONFIGURED_ENV['payments.paymob.hmacSecret']);

      const tamperedObj = { ...obj, amount_cents: 999999 };
      const result = provider.verifyWebhook({ type: 'TRANSACTION', obj: tamperedObj }, hmac);

      expect(result.signatureValid).toBe(false);
    });

    it('يرفض لو الـ secret غلط (بوابة متظبطة بمفتاح مختلف)', () => {
      const provider = new PaymobProvider(fakeConfig(CONFIGURED_ENV));
      const obj = buildTransactionObj();
      const hmacWithWrongSecret = referenceHmac(obj, 'wrong-secret');

      const result = provider.verifyWebhook({ type: 'TRANSACTION', obj }, hmacWithWrongSecret);

      expect(result.signatureValid).toBe(false);
    });

    it('يرفض لو مفيش hmac خالص في الطلب', () => {
      const provider = new PaymobProvider(fakeConfig(CONFIGURED_ENV));
      const obj = buildTransactionObj();

      const result = provider.verifyWebhook({ type: 'TRANSACTION', obj }, undefined);

      expect(result.signatureValid).toBe(false);
    });

    it('يرفض فوراً لو البوابة مش مُعدّة أصلاً (مفيش hmacSecret)', () => {
      const { 'payments.paymob.hmacSecret': _omit, ...rest } = CONFIGURED_ENV;
      const provider = new PaymobProvider(fakeConfig(rest));
      const obj = buildTransactionObj();

      const result = provider.verifyWebhook({ type: 'TRANSACTION', obj }, 'anything');

      expect(result.signatureValid).toBe(false);
      expect(result.failureReason).toContain('مُعدّة');
    });

    it('succeeded=false لو success=false في الحمولة حتى لو التوقيع صح', () => {
      const provider = new PaymobProvider(fakeConfig(CONFIGURED_ENV));
      const obj = buildTransactionObj({ success: false, data: { message: 'Insufficient funds' } });
      const hmac = referenceHmac(obj, CONFIGURED_ENV['payments.paymob.hmacSecret']);

      const result = provider.verifyWebhook({ type: 'TRANSACTION', obj }, hmac);

      expect(result.signatureValid).toBe(true);
      expect(result.succeeded).toBe(false);
      expect(result.failureReason).toBe('Insufficient funds');
    });
  });

  describe('createPayment', () => {
    it('يرفض فوراً بخطأ واضح لو البوابة مش مُعدّة، من غير أي نداء شبكة', async () => {
      const provider = new PaymobProvider(fakeConfig({ 'payments.paymob.baseUrl': 'https://accept.paymob.com' }));
      await expect(
        provider.createPayment({
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

    // docs/08 §19 بند 15 — Mobile Wallet عبر نفس حساب Paymob (اختياري، additive).
    const CREATE_PAYMENT_INPUT = {
      paymentId: 'p1',
      orderNumber: 'ORD-1',
      amountCents: 1000,
      currencyCode: 'EGP',
      customerFirstName: 'a',
      customerLastName: 'b',
      customerEmail: 'a@b.com',
      customerPhone: '+201000000000',
    };

    it('payment_methods بيحتوي بس integrationIdCard لو integrationIdMobileWallet مش مُعدّة (regression — الإضافة اختيارية)', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ client_secret: 'secret', intention_order_id: 1, status: 'pending' }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const provider = new PaymobProvider(fakeConfig(CONFIGURED_ENV));
      await provider.createPayment(CREATE_PAYMENT_INPUT);

      const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as { payment_methods: number[] };
      expect(body.payment_methods).toEqual([12345]);
    });

    it('payment_methods بيحتوي integrationIdCard وintegrationIdMobileWallet الاتنين لو المحفظة مُعدّة', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ client_secret: 'secret', intention_order_id: 1, status: 'pending' }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const provider = new PaymobProvider(
        fakeConfig({ ...CONFIGURED_ENV, 'payments.paymob.integrationIdMobileWallet': '67890' }),
      );
      await provider.createPayment(CREATE_PAYMENT_INPUT);

      const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as { payment_methods: number[] };
      expect(body.payment_methods).toEqual([12345, 67890]);
    });
  });
});
