import { AdminEarningsPolicyService } from './admin-earnings-policy.service';

describe('AdminEarningsPolicyService.createTechnicianAdjustment()', () => {
  it('serializes a person/service scope before replacing its active adjustment', async () => {
    const manager = {
      query: jest.fn()
        .mockResolvedValueOnce([]) // transaction-scoped advisory lock
        .mockResolvedValueOnce([{ id: 'technician-1' }])
        .mockResolvedValueOnce([{ id: 'service-1' }])
        .mockResolvedValueOnce([]) // no prior active adjustment
        .mockResolvedValueOnce([{ id: 'adjustment-1', adjustment_bps: 1_200 }]),
    };
    const dataSource = {
      transaction: jest.fn((work: (transactionManager: typeof manager) => unknown) => work(manager)),
    };
    const auditLog = { record: jest.fn() };
    const service = new AdminEarningsPolicyService(dataSource as never, auditLog as never);

    await service.createTechnicianAdjustment(
      'admin-1',
      'technician-1',
      { service_id: 'service-1', adjustment_bps: 1_200, reason: 'نتيجة أداء قوية' },
    );

    expect(manager.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('pg_advisory_xact_lock'),
      ['earnings-adjustment:technician-1:service-1'],
    );
    expect(manager.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM technician_profiles'),
      ['technician-1'],
    );
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'earnings_policy.technician_adjustment_created',
      entityId: 'adjustment-1',
    }), manager);
  });

  it('rejects an adjustment for a missing person before changing any active policy', async () => {
    const manager = {
      query: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };
    const dataSource = {
      transaction: jest.fn((work: (transactionManager: typeof manager) => unknown) => work(manager)),
    };
    const service = new AdminEarningsPolicyService(dataSource as never, { record: jest.fn() } as never);

    await expect(service.createTechnicianAdjustment(
      'admin-1',
      'missing-technician',
      { adjustment_bps: 500, reason: 'تجربة صالحة' },
    )).rejects.toThrow('الفني أو المساعد غير موجود');

    expect(manager.query).toHaveBeenCalledTimes(2);
  });
});
