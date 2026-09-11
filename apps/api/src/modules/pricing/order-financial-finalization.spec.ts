import { EntityManager } from 'typeorm';
import { Order, OrderPaymentStatus, OrderType } from '../orders/entities/order.entity';
import { OrderFinancialFinalizationService } from './order-financial-finalization.service';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    totalAmountCents: 100_000,
    commissionableBaseCents: 100_000,
    paymentStatus: OrderPaymentStatus.UNPAID,
    ...overrides,
  } as Order;
}

describe('OrderFinancialFinalizationService', () => {
  const service = new OrderFinancialFinalizationService();
  const manager = { save: jest.fn(async (order: Order) => order) } as unknown as EntityManager;

  beforeEach(() => jest.clearAllMocks());

  it('updates total and commissionable base in the same write', async () => {
    const order = makeOrder();

    const result = await service.increasePrice(manager, order, {
      amountCents: 20_000,
      source: 'level_premium',
      includeInCommissionableBase: true,
    });

    expect(order.totalAmountCents).toBe(120_000);
    expect(order.commissionableBaseCents).toBe(120_000);
    expect(result.requiresSupplementalCollection).toBe(false);
    expect(manager.save).toHaveBeenCalledWith(order);
  });

  it('preserves a successful payment and exposes the increase as supplemental collection', async () => {
    const order = makeOrder({ paymentStatus: OrderPaymentStatus.PAID });

    const result = await service.increasePrice(manager, order, {
      amountCents: 15_000,
      source: 'level_premium',
      includeInCommissionableBase: true,
    });

    expect(order.paymentStatus).toBe(OrderPaymentStatus.PAID);
    expect(order.totalAmountCents).toBe(115_000);
    expect(result.requiresSupplementalCollection).toBe(true);
  });

  it('does not add a non-commissionable amount to the worker pool base', async () => {
    const order = makeOrder();

    await service.increasePrice(manager, order, {
      amountCents: 5_000,
      source: 'additional_work',
      includeInCommissionableBase: false,
    });

    expect(order.totalAmountCents).toBe(105_000);
    expect(order.commissionableBaseCents).toBe(100_000);
  });

  it('rejects unsafe money values', async () => {
    const order = makeOrder();

    await expect(
      service.increasePrice(manager, order, {
        amountCents: Number.NaN,
        source: 'inspection_quote',
        includeInCommissionableBase: true,
      }),
    ).rejects.toThrow('قيمة تعديل السعر غير صالحة');
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('replaces an uncommitted admin price and keeps the worker base aligned', async () => {
    const order = makeOrder({ id: 'order-1' });
    const replacementManager = {
      query: jest.fn(async () => [{ has_payment: false, has_installment_application: false }]),
      save: jest.fn(async (row: Order) => row),
    } as unknown as EntityManager;

    const result = await service.replaceUncommittedPrice(replacementManager, order, 125_000);

    expect(order.totalAmountCents).toBe(125_000);
    expect(order.commissionableBaseCents).toBe(125_000);
    expect(result.previousTotalCents).toBe(100_000);
  });

  it('blocks raw replacement after a gateway payment or installment application starts', async () => {
    const order = makeOrder({ id: 'order-1' });
    const replacementManager = {
      query: jest.fn(async () => [{ has_payment: true, has_installment_application: false }]),
      save: jest.fn(),
    } as unknown as EntityManager;

    await expect(service.replaceUncommittedPrice(replacementManager, order, 125_000)).rejects.toThrow(
      'بدأ التزام دفع على الطلب',
    );
    expect(replacementManager.save).not.toHaveBeenCalled();
  });

  it('never lowers the total below its immutable deposit snapshot', async () => {
    const order = makeOrder({ id: 'order-1', depositAmountCents: 40_000 });
    const replacementManager = { query: jest.fn(), save: jest.fn() } as unknown as EntityManager;

    await expect(service.replaceUncommittedPrice(replacementManager, order, 30_000)).rejects.toThrow(
      'أقل من الإيداع',
    );
    expect(replacementManager.query).not.toHaveBeenCalled();
  });

  // بلاغ المالك 2026-09-11 — الشغل المدفوع اللي بيتضاف على إعادة زيارة مجانية كان بياخد نسبة
  // الطلب المثبّتة (صفر) فيروح كله للفني. الاختبارات دي بتقفل الفرق بين "الزيارة مجانية"
  // و"الشغل الجديد عليها مدفوع".
  describe('نسبة العمولة على الشغل المدفوع المضاف لإعادة الزيارة', () => {
    function revisitManager(commissionPercentage: string | null) {
      return {
        save: jest.fn(async (row: Order) => row),
        query: jest.fn(async () =>
          commissionPercentage === null ? [] : [{ commission_percentage: commissionPercentage }],
        ),
      } as unknown as EntityManager;
    }

    function makeRevisit(overrides: Partial<Order> = {}): Order {
      return makeOrder({
        id: 'revisit-1',
        serviceId: 'service-1',
        orderType: OrderType.REVISIT,
        parentOrderId: 'parent-1',
        commissionRateApplied: '0',
        totalAmountCents: 0,
        commissionableBaseCents: 0,
        ...overrides,
      });
    }

    it('بيرفع النسبة من صفر لنسبة الخدمة أول ما شغل مدفوع يتضاف', async () => {
      const order = makeRevisit();
      const revisit = revisitManager('20.00');

      await service.increasePrice(revisit, order, {
        amountCents: 30_000,
        source: 'additional_work',
        includeInCommissionableBase: true,
      });

      expect(order.commissionableBaseCents).toBe(30_000);
      expect(Number(order.commissionRateApplied)).toBe(20);
    });

    it('بيشتغل برضه على عرض السعر بعد المعاينة، مش بس البنود الإضافية', async () => {
      const order = makeRevisit();

      await service.increasePrice(revisitManager('15'), order, {
        amountCents: 50_000,
        source: 'inspection_quote',
        includeInCommissionableBase: true,
      });

      expect(Number(order.commissionRateApplied)).toBe(15);
    });

    it('بيفضل صفر لو المضاف مش داخل وعاء العمولة (مفيش شغل مدفوع جديد)', async () => {
      const order = makeRevisit();
      const revisit = revisitManager('20.00');

      await service.increasePrice(revisit, order, {
        amountCents: 30_000,
        source: 'additional_work',
        includeInCommissionableBase: false,
      });

      expect(order.totalAmountCents).toBe(30_000);
      expect(Number(order.commissionRateApplied)).toBe(0);
      expect(revisit.query).not.toHaveBeenCalled();
    });

    it('ما بيلمسش طلب عادي نسبته صفر بقرار إداري أو خدمة بلا عمولة', async () => {
      const order = makeOrder({
        id: 'plain-1',
        serviceId: 'service-1',
        orderType: OrderType.STANDARD,
        commissionRateApplied: '0',
      });
      const revisit = revisitManager('20.00');

      await service.increasePrice(revisit, order, {
        amountCents: 10_000,
        source: 'additional_work',
        includeInCommissionableBase: true,
      });

      expect(Number(order.commissionRateApplied)).toBe(0);
      expect(revisit.query).not.toHaveBeenCalled();
    });

    it('ما بيكتبش فوق نسبة غير صفرية اتثبتت على إعادة زيارة', async () => {
      const order = makeRevisit({ commissionRateApplied: '12.50' });

      await service.increasePrice(revisitManager('20.00'), order, {
        amountCents: 10_000,
        source: 'additional_work',
        includeInCommissionableBase: true,
      });

      expect(Number(order.commissionRateApplied)).toBe(12.5);
    });

    it('بيفضل صفر لو الخدمة مش موجودة أو نسبتها غير صالحة — مش بيرمي في وش الفني', async () => {
      const missing = makeRevisit();
      await service.increasePrice(revisitManager(null), missing, {
        amountCents: 10_000,
        source: 'additional_work',
        includeInCommissionableBase: true,
      });
      expect(Number(missing.commissionRateApplied)).toBe(0);

      const outOfRange = makeRevisit();
      await service.increasePrice(revisitManager('150'), outOfRange, {
        amountCents: 10_000,
        source: 'additional_work',
        includeInCommissionableBase: true,
      });
      expect(Number(outOfRange.commissionRateApplied)).toBe(0);
    });

    it('ما بيلمسش طلب v1 (نسبة null) — المسار التاريخي بيفضل زي ما هو', async () => {
      const order = makeRevisit({ commissionRateApplied: null, commissionableBaseCents: null });
      const revisit = revisitManager('20.00');

      await service.increasePrice(revisit, order, {
        amountCents: 10_000,
        source: 'additional_work',
        includeInCommissionableBase: true,
      });

      expect(order.commissionRateApplied).toBeNull();
      expect(revisit.query).not.toHaveBeenCalled();
    });
  });
});
