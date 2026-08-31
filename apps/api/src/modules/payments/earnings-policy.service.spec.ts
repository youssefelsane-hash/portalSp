import { EarningsPolicyService } from './earnings-policy.service';

describe('EarningsPolicyService', () => {
  it('uses the immutable commission snapshot and maps permanent/order roles centrally', async () => {
    const manager = {
      query: jest.fn()
        .mockResolvedValueOnce([{ settlement_policy_version: 2, platform_commission_cents_snapshot: 10_000 }])
        .mockResolvedValueOnce([
          {
            technician_id: 'leader', participant_role: 'leader', technician_kind: 'technician',
            technician_level: 'professional', level_weight_bps: 12_500, assistant_ratio_bps: 7_600,
            service_skill: 'expert', service_skill_factor_bps: 11_000,
            individual_adjustment_bps: null, order_adjustment_bps: null, used_neutral_skill_fallback: false,
          },
          {
            technician_id: 'helper', participant_role: 'assistant', technician_kind: 'technician',
            technician_level: 'verified', level_weight_bps: 11_000, assistant_ratio_bps: 7_000,
            service_skill: 'standard', service_skill_factor_bps: 10_000,
            individual_adjustment_bps: 500, order_adjustment_bps: null, used_neutral_skill_fallback: true,
          },
        ]),
    };
    const service = new EarningsPolicyService({ manager } as never);
    const result = await service.calculateOrder('order', 100_000, manager as never, true);
    expect(result.platformCommissionCents).toBe(10_000);
    expect(result.workerPoolCents).toBe(90_000);
    expect(result.participantShares[1]).toMatchObject({
      technicianId: 'helper', technicianKindSnapshot: 'technician', earningRole: 'assistant',
      assistantRatioBps: 7_000, individualAdjustmentBps: 500,
    });
    expect(manager.query.mock.calls[0][0]).toContain('FOR UPDATE');
  });

  it('refuses to run V2 logic for a V1 order', async () => {
    const manager = { query: jest.fn().mockResolvedValue([{ settlement_policy_version: 1 }]) };
    const service = new EarningsPolicyService({ manager } as never);
    await expect(service.calculateOrder('order', 100_000, manager as never)).rejects.toThrow(
      'cannot settle a V1 order',
    );
  });

  it('refuses a V2 order with no fixed commission snapshot', async () => {
    const manager = {
      query: jest.fn().mockResolvedValue([{ settlement_policy_version: 2, platform_commission_cents_snapshot: null }]),
    };
    const service = new EarningsPolicyService({ manager } as never);
    await expect(service.calculateOrder('order', 100_000, manager as never)).rejects.toThrow(
      'missing its fixed platform commission snapshot',
    );
  });
});
