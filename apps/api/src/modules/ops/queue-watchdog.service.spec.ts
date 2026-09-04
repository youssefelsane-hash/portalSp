import { Queue } from 'bullmq';
import { QueueWatchdogService } from './queue-watchdog.service';

/**
 * الحارس اللي بيقفل تدقيق C-1/C-2/S-2:
 *   • طابور تجميلي معلّق **مايسقّطش** الخدمة (C-1 — قبل كده كان أي طابور يعمل exit).
 *   • طابور توزيع معلّق **بيطلب** إعادة تشغيل (السلوك المقصود فاضل شغّال).
 *   • `assistant-matching` مراقَب فعلاً (C-2 — كان خارج القايمة خالص).
 *   • إعادة التشغيل بـ`SIGTERM` مش `process.exit` (S-2)، ومرة واحدة بس مهما تكرر الفحص.
 */
describe('QueueWatchdogService — تدرّج خطورة الطوابير (تدقيق C-1/C-2/S-2)', () => {
  const STALL_MINUTES = 5;

  /** طابور وهمي بأقدم وظيفة واقفة من `stalledMinutes` دقيقة (أو فاضي لو null). */
  const queueStalledFor = (name: string, stalledMinutes: number | null): Queue =>
    ({
      name,
      getWaiting: jest.fn(async () =>
        stalledMinutes === null ? [] : [{ timestamp: Date.now() - stalledMinutes * 60_000 }],
      ),
    }) as unknown as Queue;

  const settingsStub = {
    getBoolean: jest.fn(async (_k: string, fb: boolean) => fb),
    getNumber: jest.fn(async (_k: string, fb: number) => fb),
  };

  /** كل خدمة اتعملت في الاختبار — بتتقفل في `afterEach` بنفس مسار دورة حياة NestJS. */
  const built: QueueWatchdogService[] = [];

  /** بيبني الخدمة بأربع طوابير — الترتيب هو نفس ترتيب الـconstructor بالظبط. */
  const buildService = (queues: {
    rounds: Queue;
    assistant: Queue;
    customerStats: Queue;
    technicianStats: Queue;
  }): QueueWatchdogService => {
    const service = new QueueWatchdogService(
      queues.rounds,
      queues.assistant,
      queues.customerStats,
      queues.technicianStats,
      settingsStub as never,
    );
    built.push(service);
    return service;
  };

  const idle = () => queueStalledFor('idle', null);

  let killSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    // مش بنسيب أي واحد فيهم يتنفّذ فعلاً — الاختبار ده هيقتل الـtest runner نفسه لو عملنا كده.
    killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    // **لازم**: طلب إعادة التشغيل بيجدول مؤقّت خروج قسري بمهلة الإغلاق. من غير الإقفال ده المؤقّت
    // بيعيش بعد الاختبار وبينده `process.exit` الحقيقي جوّه سبيك تاني خالص (حصل فعلاً — كسر
    // `pricing-scenario-matrix.spec.ts`). `onModuleDestroy` هو نفس المسار اللي NestJS بينده وقت
    // الإغلاق، فالاختبار بيتنضّف بنفس الكود الحقيقي مش بحيلة خاصة بالاختبار.
    built.splice(0).forEach((service) => service.onModuleDestroy());
    killSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('C-1: طابور إحصائيات معلّق مايطلبش إعادة تشغيل خالص', async () => {
    const service = buildService({
      rounds: idle(),
      assistant: idle(),
      customerStats: queueStalledFor('customer-stats', STALL_MINUTES + 10),
      technicianStats: queueStalledFor('technician-stats', STALL_MINUTES + 10),
    });

    await service.checkAllQueues();

    // ده جوهر C-1: إعادة حساب أرقام معروضة عمرها ما تستاهل انقطاع خدمة.
    expect(killSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('طابور التوزيع المعلّق بيطلب إعادة تشغيل — بـSIGTERM مش exit خام (S-2)', async () => {
    const service = buildService({
      rounds: queueStalledFor('matching-rounds', STALL_MINUTES + 1),
      assistant: idle(),
      customerStats: idle(),
      technicianStats: idle(),
    });

    await service.checkAllQueues();

    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    // الخروج القسري مؤجّل لمهلة الإغلاق — مش بيتنفّذ فورًا مع الطلب.
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('C-2: assistant-matching مراقَب فعلاً وتعليقه بيطلب إعادة تشغيل', async () => {
    const service = buildService({
      rounds: idle(),
      assistant: queueStalledFor('assistant-matching', STALL_MINUTES + 1),
      customerStats: idle(),
      technicianStats: idle(),
    });

    await service.checkAllQueues();

    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM');
  });

  it('وظيفة واقفة أقل من العتبة مالهاش أي أثر', async () => {
    const service = buildService({
      rounds: queueStalledFor('matching-rounds', STALL_MINUTES - 1),
      assistant: idle(),
      customerStats: idle(),
      technicianStats: idle(),
    });

    await service.checkAllQueues();

    expect(killSpy).not.toHaveBeenCalled();
  });

  it('إعادة التشغيل بتتطلب مرة واحدة بس مهما اتكرر الفحص', async () => {
    const service = buildService({
      rounds: queueStalledFor('matching-rounds', STALL_MINUTES + 1),
      assistant: queueStalledFor('assistant-matching', STALL_MINUTES + 1),
      customerStats: idle(),
      technicianStats: idle(),
    });

    await service.checkAllQueues();
    await service.checkAllQueues();

    expect(killSpy).toHaveBeenCalledTimes(1);
  });

  it('Redis واقع وقت الفحص = انقطاع عادي، مش سبب لإعادة تشغيل', async () => {
    const unreachable = {
      name: 'matching-rounds',
      getWaiting: jest.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    } as unknown as Queue;

    const service = buildService({
      rounds: unreachable,
      assistant: idle(),
      customerStats: idle(),
      technicianStats: idle(),
    });

    await service.checkAllQueues();

    expect(killSpy).not.toHaveBeenCalled();
  });
});
