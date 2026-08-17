import { AssistantMatchingRecoveryService } from './assistant-matching-recovery.service';

describe('AssistantMatchingRecoveryService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('recovers both a lost start event and a lost expiry job in a bounded batch', async () => {
    const query = jest.fn().mockResolvedValue([
      { id: 'needs-start', has_expired_offer: false },
      { id: 'needs-expiry', has_expired_offer: true },
    ]);
    const startMatching = jest.fn().mockResolvedValue(undefined);
    const handleExpiry = jest.fn().mockResolvedValue(undefined);
    const service = new AssistantMatchingRecoveryService(
      { query } as never,
      { startMatching, handleExpiry } as never,
    );

    await expect(service.sweep(100)).resolves.toBe(2);
    expect(query.mock.calls[0][1]).toEqual([25]);
    expect(startMatching).toHaveBeenCalledWith('needs-start');
    expect(handleExpiry).toHaveBeenCalledWith('needs-expiry');
  });

  it('does not leave an interval handle referenced', () => {
    const unref = jest.fn();
    const timer = { unref } as unknown as ReturnType<typeof setInterval>;
    jest.spyOn(global, 'setInterval').mockReturnValue(timer);
    const clear = jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined);
    const service = new AssistantMatchingRecoveryService({} as never, {} as never);

    service.onModuleInit();
    service.onModuleDestroy();

    expect(unref).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith(timer);
  });
});
