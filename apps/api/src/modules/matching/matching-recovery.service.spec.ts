import { MatchingRecoveryService } from './matching-recovery.service';

// ADR-0018 §3-4-6 — بعد التصحيح، dispatchOrAutoConfirm() نفسها بتفرّق طوارئ/مجدول وتوجّه لكل
// مسار فورًا وقت الإنشاء (OrderDispatchListener)، فمنطق التأجيل القديم القائم على
// deferred_dispatch_lead_hours/near_term_request_days اتشال بالكامل من sweep() — بقى فحص بسيط
// (limit واحد بس) على أي طلب searching_technician من غير عرض حي sent/viewed قايم عليه.
describe('MatchingRecoveryService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('scans a bounded batch and safely continues after one dispatch failure', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'order-1' }, { id: 'order-2' }]);
    const dispatchOrAutoConfirm = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ dispatched: 1 });
    const service = new MatchingRecoveryService({ query } as never, { dispatchOrAutoConfirm } as never);

    await expect(service.sweep(100)).resolves.toBe(1);
    expect(query.mock.calls[0][1]).toEqual([25]);
    expect(dispatchOrAutoConfirm).toHaveBeenCalledTimes(2);
  });

  it('unrefs and clears its timer so tests and shutdown are not held open', () => {
    const unref = jest.fn();
    const timer = { unref } as unknown as ReturnType<typeof setInterval>;
    jest.spyOn(global, 'setInterval').mockReturnValue(timer);
    const clear = jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined);
    const service = new MatchingRecoveryService({ query: jest.fn() } as never, { dispatchOrAutoConfirm: jest.fn() } as never);

    service.onModuleInit();
    service.onModuleDestroy();

    expect(unref).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith(timer);
  });
});
