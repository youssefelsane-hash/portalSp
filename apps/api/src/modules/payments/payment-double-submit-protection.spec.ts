import { PaymentsService } from './payments.service';
import { Payment, PaymentGatewayStatus, PaymentMethod } from './entities/payment.entity';
import { OrderStatus } from '../orders/entities/order.entity';
import { crewEarningsServiceStub } from './crew-earnings.testing';

// §90.2 (طلب مالك مباشر — تدقيق ما قبل الإنتاج: حماية الدفع من ضغط مزدوج/انقطاع). راجع التعليق
// الكامل في payments.service.ts's payWithProvider() لسرد المشكلة: مفتاح idempotency بيتخزّن في
// ذاكرة الشاشة بس، فلو التطبيق اتقفل أثناء عملية دفع لسه معلّقة عند البوابة والعميل رجع فتحه
// وجرّب تاني، هيتولّد مفتاح جديد تمامًا ويقدر يفتح شحنة مستقلة تانية عند البوابة الحقيقية.
describe('PaymentsService — حماية من دفع مزدوج (§90.2)', () => {
  type PaymentsServiceInternals = {
    payWithProvider: (userId: string, orderId: string, idempotencyKey: string, method: PaymentMethod) => Promise<unknown>;
    payWithWallet: (userId: string, orderId: string, idempotencyKey: string) => Promise<Payment>;
    orders: { findOne: jest.Mock };
  };

  const makeService = (options?: {
    findOneSequence?: (unknown | null)[];
    saveImpl?: (payment: Payment) => Promise<Payment>;
    transactionImpl?: (fn: (manager: unknown) => unknown) => Promise<unknown>;
  }) => {
    const findOneMock = jest.fn();
    (options?.findOneSequence ?? []).forEach((value) => findOneMock.mockResolvedValueOnce(value));

    const paymentRepository = {
      findOne: findOneMock,
      save: jest.fn().mockImplementation(options?.saveImpl ?? (async (payment: Payment) => payment)),
      create: jest.fn().mockImplementation((data: Partial<Payment>) => data as Payment),
    };
    const provider = {
      isConfigured: true,
      createPayment: jest.fn().mockResolvedValue({ kind: 'redirect', providerReference: 'ref-123', redirectUrl: 'https://pay.example/x' }),
    };
    const paymentProviders = { getProvider: jest.fn().mockReturnValue(provider) };
    // مرّر manager وهمي فيه query() عشان nextPaymentNumber() (بيتنادى جوّه transaction في
    // payWithProvider وpayWithWallet الاتنين) يلاقي حاجة يشتغل عليها.
    const fakeManager = { query: jest.fn().mockResolvedValue([{ next_human_readable_number: 'PAY-000001' }]) };
    const dataSource = {
      transaction: jest.fn().mockImplementation(
        options?.transactionImpl ?? (async (fn: (manager: unknown) => unknown) => fn(fakeManager as never)),
      ),
    };
    const walletsService = {
      getOrCreateWallet: jest.fn().mockResolvedValue({ id: 'wallet-customer' }),
      findByUserIdOrThrow: jest.fn().mockResolvedValue({ id: 'wallet-platform' }),
      doubleEntry: jest.fn().mockResolvedValue(undefined),
    };

    const service = new PaymentsService(
      {
        // orderStatus=PENDING_PAYMENT بيخلي assertPayable() يعدّي فورًا (return مبكّر)
        // وamountOwedNow() يرجّع totalAmountCents مباشرة من غير أي استعلام إضافي — أبسط حالة
        // "قابل للدفع" ممكن تتبنى في mock من غير محاكاة الجدول كله.
        findOne: jest
          .fn()
          .mockResolvedValue({ id: 'order-1', orderNumber: 'ORD-1', orderStatus: OrderStatus.PENDING_PAYMENT, totalAmountCents: 10_000 }),
      } as never, // orders
      paymentRepository as never, // payments
      {} as never, // refunds
      { findOne: jest.fn().mockResolvedValue({ id: 'user-1', fullName: 'عميل اختبار', email: null, phoneNumber: '+201000000000' }) } as never, // users
      {} as never, // webhookEvents
      dataSource as never, // dataSource
      walletsService as never, // walletsService
      {} as never, // catalogService
      {
        findByUserIdOrThrow: jest.fn().mockResolvedValue({ id: 'customer-profile-1', userId: 'user-1' }),
        findByProfileIdOrThrow: jest.fn().mockResolvedValue({ id: 'customer-profile-1', userId: 'user-1' }),
      } as never, // customerProfiles
      {} as never, // techniciansService
      {} as never, // technicianLevelsService
      {} as never, // technicianStatsService
      {} as never, // loyaltyService
      { getNumber: jest.fn() } as never, // settingsService
      {} as never, // auditLog
      { emit: jest.fn() } as never, // events
      paymentProviders as never, // paymentProviders
      {} as never, // savedPaymentMethods
      {} as never, // installments repo
      crewEarningsServiceStub(),
    );
    return { service: service as unknown as PaymentsServiceInternals, paymentRepository, provider, dataSource };
  };

  it('يمنع فتح شحنة مستقلة تانية لنفس الطلب لو فيه دفعة PENDING حديثة (مفتاح idempotency مختلف)', async () => {
    const recentPendingPayment = {
      id: 'payment-old',
      orderId: 'order-1',
      paymentStatus: PaymentGatewayStatus.PENDING,
      initiatedAt: new Date(),
    } as Payment;
    // النداء الأول: بحث بمفتاح idempotency الجديد → مفيش تطابق. النداء التاني: بحث عن دفعة نشطة
    // حديثة لنفس الطلب → موجودة.
    const { service, provider } = makeService({ findOneSequence: [null, recentPendingPayment] });

    await expect(
      service.payWithProvider('user-1', 'order-1', 'new-idempotency-key', PaymentMethod.CARD),
    ).rejects.toThrow('محاولة دفع سابقة لسه معلّقة');
    expect(provider.createPayment).not.toHaveBeenCalled();
  });

  it('مفيش دفعة نشطة حديثة → الدفع بيكمّل عادي', async () => {
    const { service, provider } = makeService({ findOneSequence: [null, null] });

    const result = (await service.payWithProvider('user-1', 'order-1', 'fresh-key', PaymentMethod.CARD)) as {
      result: { kind: string };
    };
    expect(result.result.kind).toBe('redirect');
    expect(provider.createPayment).toHaveBeenCalledTimes(1);
  });

  it('ضغطتين متزامنتين بنفس المفتاح: القيد الفريد في الداتابيز بيرجّع نتيجة اللي كسب بدل 500 خام', async () => {
    const winnerPayment = {
      id: 'payment-winner',
      orderId: 'order-1',
      paymentStatus: PaymentGatewayStatus.PENDING,
      gatewayResponse: { cached_result: { kind: 'redirect', providerReference: 'ref-winner', redirectUrl: 'https://pay.example/winner' } },
    } as unknown as Payment;
    const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
    const { service, provider } = makeService({
      // النداء الأول (idempotency lookup): مفيش تطابق. الثاني (recent-active lookup): مفيش دفعة
      // نشطة. الثالث (بعد فشل save بالقيد الفريد): رجّع صف اللي كسب السباق.
      findOneSequence: [null, null, winnerPayment],
      saveImpl: async () => {
        throw uniqueViolation;
      },
    });

    const result = (await service.payWithProvider('user-1', 'order-1', 'racing-key', PaymentMethod.CARD)) as {
      payment: Payment;
      result: { providerReference: string };
    };
    expect(result.payment.id).toBe('payment-winner');
    expect(result.result.providerReference).toBe('ref-winner');
    // الخاسر ما نادىش provider.createPayment تاني — استخدم النتيجة المخزّنة من اللي كسب.
    expect(provider.createPayment).not.toHaveBeenCalled();
  });

  it('payWithWallet: نفس السباق — ترانزاكشن الخاسر يفشل بالقيد الفريد، بيرجّع نتيجة اللي كسب', async () => {
    const winnerPayment = { id: 'payment-winner', orderId: 'order-1' } as Payment;
    const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
    const { service } = makeService({
      findOneSequence: [null, winnerPayment],
      transactionImpl: async () => {
        throw uniqueViolation;
      },
    });

    const result = await service.payWithWallet('user-1', 'order-1', 'racing-wallet-key');
    expect(result.id).toBe('payment-winner');
  });
});
