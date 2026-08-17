import { TechnicianReferralRecoveryService } from './technician-referral-recovery.service';

describe('TechnicianReferralRecoveryService', () => {
  const reconcilePendingBonuses = jest.fn<Promise<number>, [number]>();
  const getNumber = jest.fn<Promise<number>, [string, number]>();
  let service: TechnicianReferralRecoveryService;

  beforeEach(() => {
    jest.useFakeTimers();
    reconcilePendingBonuses.mockReset().mockResolvedValue(2);
    getNumber.mockReset().mockResolvedValue(7);
    service = new TechnicianReferralRecoveryService(
      { reconcilePendingBonuses } as never,
      { getNumber } as never,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('uses the configured bounded batch for an explicit sweep', async () => {
    await expect(service.sweep()).resolves.toBe(2);
    expect(getNumber).toHaveBeenCalledWith('referral.recovery_batch_size', 25);
    expect(reconcilePendingBonuses).toHaveBeenCalledWith(7);
  });

  it('clears its interval on module destroy', async () => {
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(reconcilePendingBonuses).toHaveBeenCalledTimes(1);

    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(reconcilePendingBonuses).toHaveBeenCalledTimes(1);
  });
});
