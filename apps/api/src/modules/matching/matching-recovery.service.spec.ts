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

  it('scans a bounded batch and safely continues after one dispatch failure', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'order-1' }, { id: 'order-2' }]);
    const dispatchOrAutoConfirm = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ dispatched: 1 });
    const service = new MatchingRecoveryService(
      repository(query) as never,
      { dispatchOrAutoConfirm } as never,
      settings() as never,
    );

    await expect(service.sweep(100)).resolves.toBe(1);
    expect(query.mock.calls[0][1]).toEqual([100, 60, 3600]);
    expect(query.mock.calls[0][0]).toContain('next_matching_attempt_at');
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(dispatchOrAutoConfirm).toHaveBeenCalledTimes(2);
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
      { dispatchOrAutoConfirm: jest.fn() } as never,
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
      { dispatchOrAutoConfirm: jest.fn() } as never,
      settings({ 'matching.recovery_interval_seconds': 120 }) as never,
    );

    await service.onModuleInit();
    service.onModuleDestroy();

    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 120_000);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith(timer);
  });
});
