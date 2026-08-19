import { MatchingRecoveryService } from './matching-recovery.service';

describe('MatchingRecoveryService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('scans a bounded batch and safely continues after one dispatch failure', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'order-1' }, { id: 'order-2' }]);
    // ADR-0017 بند 8 — dispatchOrAutoConfirm بقت نقطة الدخول الموحّدة بدل dispatchNextRound مباشرة.
    const dispatchOrAutoConfirm = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ dispatched: 1 });
    const service = new MatchingRecoveryService(
      { query } as never,
      { dispatchOrAutoConfirm } as never,
      { getNumber: jest.fn().mockResolvedValue(4) } as never,
    );

    await expect(service.sweep(100)).resolves.toBe(1);
    // بند 7-8: query التالت (matching.near_term_request_days) بقى بيتضاف كـparameter تالت — نفس
    // mock الـgetNumber العام بيرجّع 4 لأي مفتاح هنا (نفس قيمة deferredLeadHours بالصدفة).
    expect(query.mock.calls[0][1]).toEqual([25, 4, 4]);
    expect(dispatchOrAutoConfirm).toHaveBeenCalledTimes(2);
  });

  it('unrefs and clears its timer so tests and shutdown are not held open', () => {
    const unref = jest.fn();
    const timer = { unref } as unknown as ReturnType<typeof setInterval>;
    jest.spyOn(global, 'setInterval').mockReturnValue(timer);
    const clear = jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined);
    const service = new MatchingRecoveryService(
      { query: jest.fn() } as never,
      { dispatchOrAutoConfirm: jest.fn() } as never,
      { getNumber: jest.fn() } as never,
    );

    service.onModuleInit();
    service.onModuleDestroy();

    expect(unref).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith(timer);
  });
});
