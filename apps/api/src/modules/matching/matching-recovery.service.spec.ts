import { MatchingRecoveryService } from './matching-recovery.service';

describe('MatchingRecoveryService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('scans a bounded batch and safely continues after one dispatch failure', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'order-1' }, { id: 'order-2' }]);
    const dispatchNextRound = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ dispatched: 1 });
    const service = new MatchingRecoveryService(
      { query } as never,
      { dispatchNextRound } as never,
      { getNumber: jest.fn().mockResolvedValue(4) } as never,
    );

    await expect(service.sweep(100)).resolves.toBe(1);
    expect(query.mock.calls[0][1]).toEqual([25, 4]);
    expect(dispatchNextRound).toHaveBeenCalledTimes(2);
  });

  it('unrefs and clears its timer so tests and shutdown are not held open', () => {
    const unref = jest.fn();
    const timer = { unref } as unknown as ReturnType<typeof setInterval>;
    jest.spyOn(global, 'setInterval').mockReturnValue(timer);
    const clear = jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined);
    const service = new MatchingRecoveryService(
      { query: jest.fn() } as never,
      { dispatchNextRound: jest.fn() } as never,
      { getNumber: jest.fn() } as never,
    );

    service.onModuleInit();
    service.onModuleDestroy();

    expect(unref).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith(timer);
  });
});
