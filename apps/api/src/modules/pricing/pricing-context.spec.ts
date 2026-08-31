import { ApiException } from '../../common/exceptions/api.exception';
import { buildPricingContext, pricingContextFormulaValues } from './pricing-context';

describe('PricingContext', () => {
  it('يحسب المدة من البداية والنهاية بالدقائق والساعات بدون الاعتماد على العميل', () => {
    const context = buildPricingContext({
      scheduledAt: '2026-08-31T10:00:00.000Z',
      scheduledEndAt: '2026-08-31T18:00:00.000Z',
    });

    expect(context.durationMinutes).toBe(480);
    expect(context.durationHours).toBe(8);
    expect(pricingContextFormulaValues(context)).toMatchObject({
      duration_minutes: 480,
      duration_hours: 8,
    });
  });

  it('يحوّل الساعات الكسرية لدقائق كاملة', () => {
    const context = buildPricingContext({ durationHours: 1.5 });
    expect(context.durationMinutes).toBe(90);
    expect(context.durationHours).toBe(1.5);
  });

  it('يرفض مدة مرسلة لا تطابق فرق البداية والنهاية', () => {
    expect(() =>
      buildPricingContext({
        scheduledAt: '2026-08-31T10:00:00.000Z',
        scheduledEndAt: '2026-08-31T18:00:00.000Z',
        durationHours: 7,
      }),
    ).toThrow(ApiException);
  });

  it('يرفض نهاية بلا بداية أو مدة غير محسوبة بدقائق كاملة', () => {
    expect(() => buildPricingContext({ scheduledEndAt: '2026-08-31T18:00:00.000Z' })).toThrow(ApiException);
    expect(() => buildPricingContext({ durationHours: 1 / 7 })).toThrow(ApiException);
  });

  it('قيم النظام المحسوبة تغلب أي مفاتيح عميل متعارضة', () => {
    const context = buildPricingContext({
      quantity: 3,
      durationHours: 2,
      serviceFieldValues: { duration_hours: 999, area: 12 },
    });
    expect(pricingContextFormulaValues(context)).toMatchObject({ quantity: 3, duration_hours: 2, area: 12 });
  });
});
