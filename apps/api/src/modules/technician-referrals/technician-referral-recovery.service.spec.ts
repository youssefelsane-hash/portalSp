import { TechnicianReferralRecoveryService } from './technician-referral-recovery.service';

describe('TechnicianReferralRecoveryService', () => {
  const reconcilePendingBonuses = jest.fn<Promise<number>, [number]>();
  const getNumber = jest.fn<Promise<number>, [string, number]>();
  let service: TechnicianReferralRecoveryService;

  beforeEach(() => {
    reconcilePendingBonuses.mockReset().mockResolvedValue(2);
    getNumber.mockReset().mockResolvedValue(7);
    service = new TechnicianReferralRecoveryService(
      { reconcilePendingBonuses } as never,
      { getNumber } as never,
      { createQueryRunner: () => ({ connect: async () => undefined, query: async () => [{ locked: true }], release: async () => undefined }) } as never,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.restoreAllMocks();
  });

  it('uses the configured bounded batch for an explicit sweep', async () => {
    await expect(service.sweep()).resolves.toBe(2);
    expect(getNumber).toHaveBeenCalledWith('referral.recovery_batch_size', 25);
    expect(reconcilePendingBonuses).toHaveBeenCalledWith(7);
  });

  it('runs the scheduled sweep and clears its interval on module destroy', async () => {
    const timer = { unref: jest.fn() } as unknown as NodeJS.Timeout;
    // النوع بقى `void`: نداء المؤقّت بيرمي الدورة جوّه القفل ويرجع فورًا، مش بيرجّع وعد.
    let scheduledSweep: (() => void) | undefined;
    jest.spyOn(global, 'setInterval').mockImplementation(((callback: () => void) => {
      scheduledSweep = callback;
      return timer;
    }) as typeof setInterval);
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined);

    service.onModuleInit();
    // نداء المؤقّت بقى fire-and-forget: بيرمي الدورة جوّه القفل الاستشاري (تدقيق A-2) ويرجع
    // فورًا. فبنستنى الـmicrotasks تخلص بدل ما نستنى قيمة راجعة مبقتش موجودة.
    scheduledSweep?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(reconcilePendingBonuses).toHaveBeenCalledTimes(1);

    service.onModuleDestroy();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
  });

  it('does not keep the Node process alive solely for its recovery interval', () => {
    const timer = { unref: jest.fn() } as unknown as NodeJS.Timeout;
    jest.spyOn(global, 'setInterval').mockReturnValue(timer);
    jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined);

    service.onModuleInit();

    expect(timer.unref).toHaveBeenCalledTimes(1);
  });
});
