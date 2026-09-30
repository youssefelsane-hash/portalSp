import { Logger } from '@nestjs/common';
import { ApiException } from '../../common/exceptions/api.exception';
import { OrderCreationService } from './order-creation.service';

/**
 * **تفاصيل الشغل مابتضيعش بصمت** (docs/08 §188، مراجعة معمارية 2026-09-30).
 *
 * `buildCustomerInputsSnapshot()` كانت بتبلع أي خطأ وترجّع `null`، فالطلب يتسجّل من غير
 * إجابات العميل («عدد الحمامات ٢، التسريب تحت الحوض») ويوصل الفني ناقص. دلوقتي الحجز بيترفض
 * برسالة واضحة إعادة المحاولة فيها آمنة.
 *
 * الدالة بتلمس `manager.query` والـlogger بس، فالاختبار بيبني الخدمة من غير حاوية DI كاملة.
 */
describe('snapshot مدخلات العميل — الفشل بيرفض الحجز بدل ما يسجّله ناقص (§188)', () => {
  type SnapshotFn = (
    manager: { query: () => Promise<unknown> },
    serviceId: string,
    values: Record<string, string | number | boolean> | undefined,
  ) => Promise<unknown>;

  const build = () => {
    const service = Object.create(OrderCreationService.prototype) as Record<string, unknown>;
    service.logger = new Logger('test');
    // الـlogger الحقيقي بيطبع في التقرير؛ الرسالة نفسها مش موضوع الاختبار.
    jest.spyOn(service.logger as Logger, 'error').mockImplementation(() => undefined);
    return (service.buildCustomerInputsSnapshot as SnapshotFn).bind(service);
  };

  it('فشل قراءة حقول الخدمة ⇒ ApiException واضح (SYS_001) مش null', async () => {
    const snapshot = build();
    const failingManager = { query: async () => Promise.reject(new Error('connection reset')) };

    const attempt = snapshot(failingManager, 'svc-1', { bathrooms: 2 });
    await expect(attempt).rejects.toBeInstanceOf(ApiException);
    await expect(snapshot(failingManager, 'svc-1', { bathrooms: 2 })).rejects.toMatchObject({ code: 'SYS_001' });
  });

  it('ضابط: مفيش إجابات أصلاً ⇒ null بلا أي استعلام (مش كل null بقى خطأ)', async () => {
    const snapshot = build();
    const manager = { query: jest.fn(async () => []) };
    await expect(snapshot(manager, 'svc-1', undefined)).resolves.toBeNull();
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('ضابط: القراءة نجحت ⇒ الإجابات بتتسجّل بتسمياتها', async () => {
    const snapshot = build();
    const manager = {
      query: async () => [
        {
          field_key: 'bathrooms',
          field_type: 'number',
          label_ar: 'عدد الحمامات',
          unit_ar: null,
          options: null,
          display_order: 1,
          is_required: true,
          default_value: null,
          min_value: null,
          max_value: null,
        },
      ],
    };
    await expect(snapshot(manager, 'svc-1', { bathrooms: 2 })).resolves.toEqual([
      expect.objectContaining({ key: 'bathrooms', label: 'عدد الحمامات', value: '2' }),
    ]);
  });
});
