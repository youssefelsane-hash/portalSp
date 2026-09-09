import { MatchingRecoveryService } from './matching-recovery.service';

// ADR-0018 §3-4-6 — بعد التصحيح، dispatchOrAutoConfirm() نفسها بتفرّق طوارئ/مجدول وتوجّه لكل
// مسار فورًا وقت الإنشاء (OrderDispatchListener)، فمنطق التأجيل القديم القائم على
// deferred_dispatch_lead_hours/near_term_request_days اتشال بالكامل من sweep() — بقى فحص بسيط
// (limit واحد بس) على أي طلب searching_technician من غير عرض حي sent/viewed قايم عليه.
describe('MatchingRecoveryService', () => {
  afterEach(() => jest.restoreAllMocks());

  const settings = (overrides: Record<string, number> = {}) => ({
    getNumber: jest.fn(async (key: string, fallback: number) => overrides[key] ?? fallback),
  });

  const repository = (query: jest.Mock) => ({
    manager: {
      transaction: (run: (manager: { query: jest.Mock }) => Promise<unknown>) => run({ query }),
    },
  });

  // **الـsweep بتجدول، مش بتنفّذ.** كانت بتنادي `dispatchOrAutoConfirm()` لكل صف بالتتابع في
  // نفس العملية، فدفعة ٢٥ طلب عالق كانت بتحتجز اتصالات القاعدة ~١٠ ثواني كل دورة والعملاء
  // الحقيقيين بياخدوا 503. الاختبار ده بيقفل على إنها بقت **حجز وظايف بس** (التفاصيل والقياس
  // في `matching-dispatch-queue.client.ts`).
  it('بتحجز وظيفة لكل طلب عالق، ومابتنفّذش التوزيع بنفسها', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'order-1' }, { id: 'order-2' }]);
    // فشل حجز واحدة (Redis مش متاح) مابيوقفش الباقي — والطلب مش ضايع لأن الدورة الجاية بتعيد.
    const enqueueDispatch = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const service = new MatchingRecoveryService(
      repository(query) as never,
      { enqueueDispatch } as never,
      settings() as never,
    );

    await expect(service.sweep(100)).resolves.toBe(1);
    expect(query.mock.calls[0][1]).toEqual([100, 60, 3600]);
    expect(query.mock.calls[0][0]).toContain('next_matching_attempt_at');
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(enqueueDispatch).toHaveBeenCalledTimes(2);
    expect(enqueueDispatch).toHaveBeenCalledWith('order-1');
    expect(enqueueDispatch).toHaveBeenCalledWith('order-2');
  });

  /**
   * **انحدار البَقّة اللي عاشت شهور** (تدقيق ج-٤، 2026-09-09): الاختبار فوق كان بيمرّر
   * `[{id},{id}]` — وده شكل نتيجة `SELECT`. الدرايفر الحقيقي بيرجّع `UPDATE … RETURNING`
   * كـ`[rows, affectedCount]`، فالكود الحقيقي كان بيلف على عنصرين (المصفوفة + الرقم) ويبعت
   * `undefined` مرتين. النتيجة: الـsweep بتزوّد العدّاد وبتأجّل الموعد **من غير ما تعيد توزيع
   * ولا طلب واحد**، والطلب اللي فشل توزيعه أول مرة بيعلق للأبد. الـmock الغلط هو اللي خلّى
   * السويتة تعدّي وهي مش بتغطّي الحالة الحقيقية — فالشكل ده لازم يفضل مختبَر صراحةً.
   */
  it('بتفهم شكل [rows, affectedCount] الحقيقي بتاع UPDATE … RETURNING', async () => {
    const query = jest.fn().mockResolvedValue([[{ id: 'order-1' }, { id: 'order-2' }], 2]);
    const enqueueDispatch = jest.fn().mockResolvedValue(true);
    const service = new MatchingRecoveryService(
      repository(query) as never,
      { enqueueDispatch } as never,
      settings() as never,
    );

    await expect(service.sweep(100)).resolves.toBe(2);
    expect(enqueueDispatch).toHaveBeenCalledTimes(2);
    expect(enqueueDispatch).toHaveBeenCalledWith('order-1');
    expect(enqueueDispatch).toHaveBeenCalledWith('order-2');
    // الحارس الحاسم: ولا نداء واحد بمعرّف فاضي.
    for (const [orderId] of enqueueDispatch.mock.calls) expect(orderId).toBeTruthy();
  });

  it('UPDATE ماأثّرش على أي طلب → مفيش أي حجز وظيفة', async () => {
    const query = jest.fn().mockResolvedValue([[], 0]);
    const enqueueDispatch = jest.fn().mockResolvedValue(true);
    const service = new MatchingRecoveryService(
      repository(query) as never,
      { enqueueDispatch } as never,
      settings() as never,
    );

    await expect(service.sweep(100)).resolves.toBe(0);
    expect(enqueueDispatch).not.toHaveBeenCalled();
  });

  it('reads batch size and backoff from settings instead of a deployment-time constant', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const configured = settings({
      'matching.recovery_batch_size': 80,
      'matching.recovery_initial_backoff_seconds': 120,
      'matching.recovery_max_backoff_seconds': 7200,
    });
    const service = new MatchingRecoveryService(
      repository(query) as never,
      { enqueueDispatch: jest.fn().mockResolvedValue(true) } as never,
      configured as never,
    );

    await expect(service.sweep()).resolves.toBe(0);

    expect(query.mock.calls[0][1]).toEqual([80, 120, 7200]);
    expect(configured.getNumber).toHaveBeenCalledWith('matching.recovery_batch_size', 25);
  });

  it('uses the configured interval, unrefs its timer, and clears it on shutdown', async () => {
    const unref = jest.fn();
    const timer = { unref } as unknown as ReturnType<typeof setTimeout>;
    const setTimer = jest.spyOn(global, 'setTimeout').mockReturnValue(timer);
    const clear = jest.spyOn(global, 'clearTimeout').mockImplementation(() => undefined);
    const service = new MatchingRecoveryService(
      repository(jest.fn()) as never,
      { enqueueDispatch: jest.fn().mockResolvedValue(true) } as never,
      settings({ 'matching.recovery_interval_seconds': 120 }) as never,
    );

    await service.onModuleInit();
    service.onModuleDestroy();

    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 120_000);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith(timer);
  });
});
