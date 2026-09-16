import { BookingSlotSuggestionService } from './booking-slot-suggestion.service';

/**
 * **حساب واحد لكل مفتاح في اللحظة الواحدة** (طلب مالك 2026-09-16، docs/08 §152).
 *
 * > «مهم نتأكد إن مفيش جزء صغير في الـbooking أو availability أو schedule lookup يبقى أبطأ من
 * >  باقي السيستم ويبدأ يسبب lag تحت الضغط.»
 *
 * الكاش (٩٠ ثانية) بيغطّي الطلب التاني وما بعده، لكنه مابيغطّيش **الطلبات المتوازية على مفتاح
 * بارد**: كلهم بيلاقوه فاضي في نفس اللحظة فكلهم بيحسبوا. مقاس حيًا على ٤٠ فني قبل الإصلاح:
 *
 *   ٢٠ نداء متوازي على مفتاح بارد = ٢٣٠٩ms  →  بعد الإصلاح ٦٦١ms (٣.٥×)
 *
 * الاختبار ده بيثبّت **السلوك** مش الرقم: نداء واحد للقاعدة مهما كان عدد الطلبات المتوازية.
 */
describe('اقتراح الأيام — دمج الحسابات المتوازية (docs/08 §152)', () => {
  const zoneId = '11111111-1111-7111-8111-111111111111';
  const addressId = '22222222-2222-7222-8222-222222222222';
  const serviceId = '33333333-3333-7333-8333-333333333333';
  const customerUserId = '44444444-4444-7444-8444-444444444444';

  /** كاش وهمي بسلوك Redis الحقيقي: بيرجّع null لحد ما حد يكتب فيه. */
  const makeCache = () => {
    const store = new Map<string, string>();
    return {
      store,
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    };
  };

  const buildService = (cache: ReturnType<typeof makeCache>, onQuery: () => void) => {
    const dataSource = {
      // العنوان بيتقري بـgetRepository، والطاقة بـquery — الاتنين مستقلين.
      getRepository: () => ({
        findOne: async () => ({
          id: addressId,
          userId: customerUserId,
          cityId: '55555555-5555-7555-8555-555555555555',
          location: { coordinates: [31.25, 30.05] },
        }),
      }),
      query: jest.fn(async () => {
        onQuery();
        // تأخير مقصود: من غيره النداءات بتخلص بالترتيب ومايحصلش تزامن حقيقي أصلاً.
        await new Promise((resolve) => setTimeout(resolve, 40));
        return [{ day: '2027-06-10', available_technicians: '3', idle_technicians: '2' }];
      }),
    };
    const settings = {
      getNumber: jest.fn(async (_key: string, fallback: number) => fallback),
      getString: jest.fn(async (_key: string, fallback: string) => fallback),
      getBoolean: jest.fn(async (_key: string, fallback: boolean) => fallback),
    };
    const geo = { findZoneForPoint: jest.fn(async () => ({ id: zoneId })) };
    return new BookingSlotSuggestionService(
      dataSource as never,
      settings as never,
      geo as never,
      cache as never,
    );
  };

  const callConcurrently = async (service: BookingSlotSuggestionService, times: number) =>
    Promise.all(
      Array.from({ length: times }, () =>
        service.suggestDays({ customerUserId, serviceId, addressId, durationMinutes: 90 }),
      ),
    );

  it('عشرين نداء متوازي على مفتاح بارد = **حساب واحد** للقاعدة', async () => {
    let computes = 0;
    const cache = makeCache();
    const service = buildService(cache, () => {
      computes += 1;
    });

    const results = await callConcurrently(service, 20);

    expect(computes).toBe(1);
    // وكلهم لازم ياخدوا **نفس** النتيجة — مش واحد بنتيجة والباقي فاضي.
    expect(results).toHaveLength(20);
    for (const result of results) {
      expect(result.days.length).toBeGreaterThan(0);
      expect(result.days[0].idleTechnicians).toBe(2);
    }
  });

  it('بعد ما الحساب يخلص، الكاش هو اللي بيخدم — ومفيش حساب تاني', async () => {
    let computes = 0;
    const cache = makeCache();
    const service = buildService(cache, () => {
      computes += 1;
    });

    await callConcurrently(service, 5);
    expect(computes).toBe(1);
    await callConcurrently(service, 5);
    expect(computes).toBe(1);
  });

  /**
   * **الحالة اللي بتسيب وعد ميت لو الإصلاح اتعمل غلط**: لو الصف مااتشالش من الخريطة عند الفشل،
   * كل الطلبات اللي بعده على نفس المفتاح بتفضل تفشل للأبد بنفس الوعد المرفوض.
   */
  it('فشل الحساب مابيسيبش وعد ميت — المحاولة اللي بعدها بتحسب من جديد', async () => {
    const cache = makeCache();
    let attempts = 0;
    const dataSource = {
      getRepository: () => ({
        findOne: async () => ({
          id: addressId,
          userId: customerUserId,
          cityId: '55555555-5555-7555-8555-555555555555',
          location: { coordinates: [31.25, 30.05] },
        }),
      }),
      query: jest.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('القاعدة وقعت');
        return [{ day: '2027-06-10', available_technicians: '1', idle_technicians: '1' }];
      }),
    };
    const settings = {
      getNumber: jest.fn(async (_k: string, f: number) => f),
      getString: jest.fn(async (_k: string, f: string) => f),
      getBoolean: jest.fn(async (_k: string, f: boolean) => f),
    };
    const geo = { findZoneForPoint: jest.fn(async () => ({ id: zoneId })) };
    const service = new BookingSlotSuggestionService(
      dataSource as never,
      settings as never,
      geo as never,
      cache as never,
    );

    await expect(
      service.suggestDays({ customerUserId, serviceId, addressId, durationMinutes: 90 }),
    ).rejects.toThrow('القاعدة وقعت');

    const recovered = await service.suggestDays({
      customerUserId,
      serviceId,
      addressId,
      durationMinutes: 90,
    });
    expect(recovered.days).toHaveLength(1);
    expect(attempts).toBe(2);
  });
});
