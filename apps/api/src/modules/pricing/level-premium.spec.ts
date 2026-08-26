import { EntityManager } from 'typeorm';
import { LevelPremiumService } from './level-premium.service';
import { Order } from '../orders/entities/order.entity';
import { DEFAULT_COMMISSION_BASE_POLICY } from './commission-base';

// docs/08 §60.3 — بلاغ المالك بالحرف: «لو حد عمل اختيار تلقائي، السعر بيجيله أوتوماتيك أقل حاجة
// … من غير التضخم بتاع كل شخص على حدة، فده كده ما ينفعش».
//
// السبب في الكود: `OrdersService.create()` بيسعّر بمضاعف مستوى = 1 لما الفني مش معروف
// (knownTechnicianLevel = undefined). الخدمة دي بتقفل الفجوة بعد التعيين.

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    orderNumber: 'ORD-1',
    serviceId: 'svc-1',
    requestedTechnicianId: null,
    estimatedPriceCents: 100_000,
    totalAmountCents: 120_000,
    commissionableBaseCents: 100_000,
    levelPremiumCents: 0,
    ...overrides,
  } as Order;
}

function makeService(opts: {
  multiplier: number;
  policy?: string;
  basePolicy?: Partial<typeof DEFAULT_COMMISSION_BASE_POLICY>;
}) {
  const saved: Order[] = [];
  const manager = { save: async (o: Order) => saved.push(o) } as unknown as EntityManager;
  const service = new LevelPremiumService(
    { resolveLevelPriceMultiplier: async () => opts.multiplier } as never,
    { getString: async (_k: string, fallback: string) => opts.policy ?? fallback } as never,
    { getPolicy: async () => ({ ...DEFAULT_COMMISSION_BASE_POLICY, ...opts.basePolicy }) } as never,
  );
  return { service, manager, saved };
}

const technician = { currentLevel: 'expert', pricingTier: null } as never;

describe('فرق الفني المميّز بعد التعيين التلقائي (docs/08 §60.3)', () => {
  it('فني مستواه بيزوّد 20%: الفرق بيتضاف للطلب كسطر مستقل', async () => {
    const { service, manager } = makeService({ multiplier: 1.2 });
    const order = makeOrder();

    const premium = await service.applyOnAutoAssignment(manager, order, technician);

    expect(premium).toBe(20_000);
    expect(order.levelPremiumCents).toBe(20_000);
    expect(order.totalAmountCents).toBe(140_000);
  });

  it('الفرق من نصيب الفني — بيكبّر وعاء العمولة (قرار المالك: الليفل بيزوّد فلوسه هو)', async () => {
    const { service, manager } = makeService({ multiplier: 1.2 });
    const order = makeOrder();

    await service.applyOnAutoAssignment(manager, order, technician);

    expect(order.commissionableBaseCents).toBe(120_000);
  });

  it('العميل اختار الفني بنفسه: مفيش أي إضافة (الفرق داخل السعر أصلاً — تحصيل مزدوج)', async () => {
    const { service, manager } = makeService({ multiplier: 1.5 });
    const order = makeOrder({ requestedTechnicianId: 'tech-1' });

    expect(await service.applyOnAutoAssignment(manager, order, technician)).toBe(0);
    expect(order.totalAmountCents).toBe(120_000);
    expect(order.levelPremiumCents).toBe(0);
  });

  it('مستوى بلا مضاعف (=1): مفيش إضافة', async () => {
    const { service, manager } = makeService({ multiplier: 1 });
    const order = makeOrder();
    expect(await service.applyOnAutoAssignment(manager, order, technician)).toBe(0);
    expect(order.totalAmountCents).toBe(120_000);
  });

  it('سياسة absorb: الشركة بتتحمّل الفرق والسعر ما بيتغيّرش', async () => {
    const { service, manager } = makeService({ multiplier: 1.3, policy: 'absorb' });
    const order = makeOrder();
    expect(await service.applyOnAutoAssignment(manager, order, technician)).toBe(0);
    expect(order.totalAmountCents).toBe(120_000);
  });

  it('لو الأدمن شال مضاعف المستوى من وعاء العمولة: الفرق بيتحصّل بس ما بيدخلش نصيب الفني', async () => {
    const { service, manager } = makeService({ multiplier: 1.2, basePolicy: { includeLevelPremium: false } });
    const order = makeOrder();

    await service.applyOnAutoAssignment(manager, order, technician);

    expect(order.totalAmountCents).toBe(140_000);
    expect(order.commissionableBaseCents).toBe(100_000);
  });

  it('طلب قبل ADR-0037 (وعاء = null): بيفضل null، مفيش كسر', async () => {
    const { service, manager } = makeService({ multiplier: 1.2 });
    const order = makeOrder({ commissionableBaseCents: null });

    await service.applyOnAutoAssignment(manager, order, technician);

    expect(order.commissionableBaseCents).toBeNull();
    expect(order.totalAmountCents).toBe(140_000);
  });

  it('حارس التحصيل المزدوج: إعادة التعيين مابتضفش فرق تاني فوق القديم', async () => {
    const { service, manager } = makeService({ multiplier: 1.2 });
    const order = makeOrder();

    // التعيين الأول
    expect(await service.applyOnAutoAssignment(manager, order, technician)).toBe(20_000);
    // الفني لغى وأعيد التوزيع لفني تاني مميّز — لازم يتخطّى
    expect(await service.applyOnAutoAssignment(manager, order, technician)).toBe(0);

    expect(order.levelPremiumCents).toBe(20_000);
    expect(order.totalAmountCents).toBe(140_000);
  });
});