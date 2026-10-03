import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MarkCommissionsPaidDto } from '../marketing/dto/marketing-source.dto';
import { PromoCodesService } from './promo-codes.service';
import { DiscountType, PromoCode } from './entities/promo-code.entity';

function partnerCode(overrides: Partial<PromoCode> = {}): PromoCode {
  return Object.assign(new PromoCode(), {
    id: 'promo-id',
    code: 'DOORMAN1',
    isActive: true,
    deletedAt: null,
    discountEnabled: false,
    // قيم خصم متخزّنة عمدًا: كود الشريك لازم يتجاهلها مهما كانت.
    discountType: DiscountType.PERCENTAGE,
    discountValue: '50',
    maxDiscountCents: null,
    // كل شروط الخصم دي كانت هترفض الطلب لو اتطبّقت على كود مابيخصمش.
    minOrderAmountCents: 999_999,
    appliesToServiceIds: ['other-service'],
    appliesToZoneIds: ['other-zone'],
    newCustomersOnly: true,
    restrictedToUserId: null,
    usageLimitTotal: 1,
    usageLimitPerUser: 1,
    usedCount: 1,
    budgetCents: 0,
    spentCents: 0,
    validFrom: new Date(Date.now() - 60_000),
    validUntil: new Date(Date.now() + 60_000),
    ...overrides,
  });
}

function serviceFor(promo: PromoCode, usedByUser = 5) {
  return new PromoCodesService(
    { findOne: jest.fn().mockResolvedValue(promo) } as never,
    { count: jest.fn().mockResolvedValue(usedByUser) } as never,
    { record: jest.fn() } as never,
  );
}

const ctx = {
  serviceId: 'service-id',
  zoneId: 'zone-id',
  totalBeforeDiscountCents: 10_000,
  inspectionFeeCents: 0,
  isNewCustomer: false,
};

describe('PromoCodesService — كود شريك (إسناد فقط، docs/08 §195)', () => {
  it('بيتقبل وقت الحجز بخصم صفر — عشان يربط الطلب بالكود من غير ما يلمس سعر العميل', async () => {
    const result = await serviceFor(partnerCode()).preview('DOORMAN1', 'customer-id', ctx);
    expect(result.discountCents).toBe(0);
    expect(result.promoCode.id).toBe('promo-id');
  });

  it('شروط الخصم (حد أدنى/خدمة/منطقة/عملاء جداد/حدود/ميزانية) مابتترفضش طلب على كود مابيخصمش', async () => {
    await expect(serviceFor(partnerCode(), 99).preview('DOORMAN1', 'customer-id', ctx)).resolves.toMatchObject({ discountCents: 0 });
  });

  it('الكود الموقوف أو المنتهي أو المخصص لحد تاني بيترفض برضه — الإسناد مش باب خلفي', async () => {
    await expect(serviceFor(partnerCode({ isActive: false })).preview('DOORMAN1', 'c', ctx)).rejects.toThrow('مش شغال');
    await expect(
      serviceFor(partnerCode({ validUntil: new Date(Date.now() - 1_000) })).preview('DOORMAN1', 'c', ctx),
    ).rejects.toThrow('منتهي');
    await expect(
      serviceFor(partnerCode({ restrictedToUserId: 'someone-else' })).preview('DOORMAN1', 'c', ctx),
    ).rejects.toThrow('مش بتاعك');
  });

  it('كود الخصم العادي بيفضل بشروطه زي ما هو', async () => {
    const discount = partnerCode({ discountEnabled: true, minOrderAmountCents: 0, appliesToServiceIds: null, appliesToZoneIds: null, newCustomersOnly: false, usageLimitTotal: null, budgetCents: null, discountValue: '10' });
    await expect(serviceFor(discount, 0).preview('DOORMAN1', 'c', ctx)).resolves.toMatchObject({ discountCents: 1_000 });
    await expect(serviceFor(partnerCode({ discountEnabled: true }), 0).preview('DOORMAN1', 'c', ctx)).rejects.toThrow('الحد الأدنى');
  });
});

describe('تعليم مستحقات الشريك «اتدفعت» — معرّفات UUIDv7', () => {
  it('بيقبل معرّفات النظام الحقيقية (v7) — كانت بترجع 400 دايمًا مع IsUUID(4)', async () => {
    const dto = plainToInstance(MarkCommissionsPaidDto, { ids: ['01a10141-8395-71e4-bc96-41ff859e54ef'] });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('لسه بيرفض قايمة فاضية وأي نص مش UUID', async () => {
    expect(await validate(plainToInstance(MarkCommissionsPaidDto, { ids: [] }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(MarkCommissionsPaidDto, { ids: ['not-a-uuid'] }))).not.toHaveLength(0);
  });
});
