import { TechnicianProgressionService } from './technician-progression.service';

/**
 * جدولة تقييم الترقية (docs/08 §129).
 *
 * **الفجوة اللي الاختبار ده بيقفلها**: `calculateAll()` مكانش ليها أي مُشغّل تلقائي، و
 * `GET /technician/progression` بتقرا صف محفوظ — فالفني كان بيشوف شاشة فاضية للأبد (اتأكد على
 * قاعدة التطوير: 66 فني معتمد، صفر صف تقدّم).
 *
 * الاختبار مش بيحاول يعيد اختبار حساب الأهلية (متغطّي في
 * `technician-progression-calculation.service.spec.ts`) — بيتحقق من التوصيلة نفسها: إن الخدمة
 * بتسجّل مؤقتات فعلاً، وبتنضّفها، وإن دورة متأخرة مابتتداخلش مع اللي بعدها، وإن أي فشل بيتبلع.
 */
describe('TechnicianProgressionService — جدولة التقييم التلقائي', () => {
  function buildService(calculateAll: jest.Mock): TechnicianProgressionService {
    const service = Object.create(TechnicianProgressionService.prototype) as TechnicianProgressionService;
    // الحقول الخاصة بالجدولة بس — باقي التبعيات مالهاش أي دور في المسار ده.
    Object.assign(service, {
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      timer: null,
      firstRunTimer: null,
      sweepRunning: false,
      calculateAll,
      // الجدولة بقت بتعدّي على قفل استشاري (تدقيق A-2) — الـstub بيقول «القفل معايا».
      dataSource: {
        createQueryRunner: () => ({
          connect: async () => undefined,
          query: async () => [{ locked: true }],
          release: async () => undefined,
        }),
      },
    });
    return service;
  }

  afterEach(() => jest.useRealTimers());

  it('onModuleInit بيسجّل تشغيل أول بعد دقيقة + دورة دورية، وonModuleDestroy بينضّفهم', async () => {
    jest.useFakeTimers();
    const calculateAll = jest.fn().mockResolvedValue({ evaluated: 3, autoPromoted: 0 });
    const service = buildService(calculateAll);

    service.onModuleInit();
    expect(jest.getTimerCount()).toBe(2);

    // مفيش نداء قبل ما الدقيقة تعدّي — مش عايزين حِمل على الإقلاع نفسه.
    expect(calculateAll).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60_000);
    await jest.runAllTicks();
    await Promise.resolve();
    expect(calculateAll).toHaveBeenCalledTimes(1);

    // `advanceTimersByTime` بيحرّك المؤقتات بس ومابيفرّغش الـmicrotasks، فقفل `sweepRunning`
    // بتاع الدورة الأولى مكانش بيتفك — لازم نفرّغهم بإيدينا هنا. في الإنتاج 6 ساعات بتعدّي
    // بينهم فعليًا، فالحالة دي خاصة بالاختبار مش بالسلوك.
    await jest.runAllTicks();
    await Promise.resolve();

    jest.advanceTimersByTime(6 * 60 * 60 * 1000);
    // القفل الاستشاري بيضيف خطوات async قبل النداء الفعلي — لازم نفرّغ الـmicrotasks تاني.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(calculateAll).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('دورة لسه شغالة: الدورة الجديدة بتتخطى بدل ما تتداخل', async () => {
    let release: () => void = () => undefined;
    // أول نداء بس هو اللي بيعلّق؛ اللي بعده بيرجع فورًا عشان الاختبار مايعلّقش على وعد
    // محدش بيحلّه (ده كان سبب فشل أول نسخة من الاختبار ده).
    const calculateAll = jest
      .fn()
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          release = () => resolve({ evaluated: 1, autoPromoted: 0 });
        }),
      )
      .mockResolvedValue({ evaluated: 1, autoPromoted: 0 });

    const service = buildService(calculateAll);
    const runSweep = (service as unknown as { runScheduledSweep(): Promise<void> }).runScheduledSweep.bind(service);

    const first = runSweep();
    await runSweep(); // التانية المفروض تتخطى فورًا لأن الأولى لسه شغالة
    expect(calculateAll).toHaveBeenCalledTimes(1);

    release();
    await first;

    // بعد ما الأولى تخلص، القفل بيتفك والدورة الجاية بتشتغل عادي.
    await runSweep();
    expect(calculateAll).toHaveBeenCalledTimes(2);
  });

  it('فشل الحساب بيتسجّل ومابيرميش — تقييم الترقية مالوش أي أثر على عملية مستخدم جارية', async () => {
    const calculateAll = jest.fn().mockRejectedValue(new Error('DB عابر'));
    const service = buildService(calculateAll);
    const runSweep = (service as unknown as { runScheduledSweep(): Promise<void> }).runScheduledSweep.bind(service);

    await expect(runSweep()).resolves.toBeUndefined();
    // والقفل اتفك عشان الدورة الجاية تعرف تشتغل رغم الفشل.
    await runSweep();
    expect(calculateAll).toHaveBeenCalledTimes(2);
  });
});
