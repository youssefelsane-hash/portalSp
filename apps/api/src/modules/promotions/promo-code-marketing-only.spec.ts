import { PromoCodesService } from './promo-codes.service';
import { DiscountType, PromoCode } from './entities/promo-code.entity';

describe('PromoCodesService — source-only promotion', () => {
  it('لا يسمح أبدًا لكود الإسناد فقط أن يدخل في معادلة خصم العميل', async () => {
    const promo = Object.assign(new PromoCode(), {
      id: 'promo-id',
      code: 'DOORMAN1',
      isActive: true,
      deletedAt: null,
      discountEnabled: false,
      discountType: DiscountType.PERCENTAGE,
      discountValue: '0',
      maxDiscountCents: null,
      minOrderAmountCents: 0,
      appliesToServiceIds: null,
      appliesToZoneIds: null,
      newCustomersOnly: false,
      restrictedToUserId: null,
      usageLimitTotal: null,
      usageLimitPerUser: 1,
      usedCount: 0,
      budgetCents: null,
      spentCents: 0,
      validFrom: new Date(Date.now() - 60_000),
      validUntil: new Date(Date.now() + 60_000),
    });
    const service = new PromoCodesService(
      { findOne: jest.fn().mockResolvedValue(promo) } as never,
      { count: jest.fn() } as never,
      { record: jest.fn() } as never,
    );

    await expect(
      service.preview('DOORMAN1', 'customer-id', {
        serviceId: 'service-id',
        zoneId: 'zone-id',
        totalBeforeDiscountCents: 10_000,
        inspectionFeeCents: 0,
        isNewCustomer: true,
      }),
    ).rejects.toThrow('للتسويق والإسناد فقط');
  });
});
