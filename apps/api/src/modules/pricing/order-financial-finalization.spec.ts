import { EntityManager } from 'typeorm';
import { Order, OrderPaymentStatus } from '../orders/entities/order.entity';
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
});
