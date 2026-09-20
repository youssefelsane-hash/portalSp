import { EarningsPolicyService } from './earnings-policy.service';

describe('EarningsPolicyService', () => {
  it('uses the immutable commission percentage snapshot and maps permanent/order roles centrally', async () => {
    const manager = {
      query: jest.fn()
        .mockResolvedValueOnce([{ settlement_policy_version: 2, commission_rate_applied: 10 }])
        .mockResolvedValueOnce([
          {
            technician_id: 'leader', participant_role: 'leader', technician_kind: 'technician',
            technician_level: 'professional', level_weight_bps: 12_500, assistant_ratio_bps: 7_600,
            service_wage_tier: 'expert', service_wage_factor_bps: 11_000,
            individual_adjustment_bps: null, order_adjustment_bps: null, used_neutral_skill_fallback: false,
          },
          {
            technician_id: 'helper', participant_role: 'assistant', technician_kind: 'technician',
            technician_level: 'verified', level_weight_bps: 11_000, assistant_ratio_bps: 7_000,
            service_wage_tier: 'standard', service_wage_factor_bps: 10_000,
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

  it('refuses an earnings order with no commission percentage snapshot', async () => {
    const manager = {
      query: jest.fn().mockResolvedValue([{ settlement_policy_version: 2, commission_rate_applied: null }]),
    };
    const service = new EarningsPolicyService({ manager } as never);
    await expect(service.calculateOrder('order', 100_000, manager as never)).rejects.toThrow(
      'missing its platform commission percentage snapshot',
    );
  });

  // **قرار مالك 2026-09-20 (ADR-0108)** — يعدّل الأثر المالي في ADR-0055 §3: معامل المساعد
  // بيتحدد من `technician_kind` كمان، مش من `participant_role` وحده. التست ده كان بيثبّت
  // العكس بالظبط (القائد المساعد بياخد دور فني)، فاتقلب لنص القاعدة الجديدة.
  it('بيدّي المساعد القائد دور مساعد في القسمة — رتبته هي اللي بتحكم', async () => {
    const rows = (technicianKind: 'technician' | 'assistant') => [
      {
        technician_id: 'leader', participant_role: 'leader', technician_kind: technicianKind,
        technician_level: 'professional', level_weight_bps: 12_500, assistant_ratio_bps: 6_500,
        service_wage_tier: 'standard', service_wage_factor_bps: 10_000,
        individual_adjustment_bps: null, order_adjustment_bps: null, used_neutral_skill_fallback: false,
      },
      {
        technician_id: 'helper', participant_role: 'assistant', technician_kind: 'assistant',
        technician_level: 'professional', level_weight_bps: 12_500, assistant_ratio_bps: 6_500,
        service_wage_tier: 'standard', service_wage_factor_bps: 10_000,
        individual_adjustment_bps: null, order_adjustment_bps: null, used_neutral_skill_fallback: false,
      },
    ];
    const run = async (technicianKind: 'technician' | 'assistant') => {
      const manager = {
        query: jest.fn()
          .mockResolvedValueOnce([{ settlement_policy_version: 2, commission_rate_applied: 0 }])
          .mockResolvedValueOnce(rows(technicianKind)),
      };
      return new EarningsPolicyService({ manager } as never).calculateOrder('order', 165_000, manager as never);
    };

    const asAssistant = await run('assistant');
    expect(asAssistant.participantShares[0]).toMatchObject({
      technicianId: 'leader', technicianKindSnapshot: 'assistant', earningRole: 'assistant', isLeader: true,
    });

    // القائد لسه بيتعرض كـ«قائد» — التعديل على **معامل الفلوس** بس، مش على دوره في الطلب.
    expect(asAssistant.participantShares[0].isLeader).toBe(true);

    // الطلب ده: قائد مساعد + منضم مساعد، الاتنين `professional` بنفس المعاملات ⇒ نص بنص.
    expect(asAssistant.participantShares.map((share) => share.shareCents)).toEqual([82_500, 82_500]);

    // وقائد **فني** جنب نفس المساعد لسه بياخد أكتر — الفرق بين الفني والمساعد ماتشالش.
    const asTechnician = await run('technician');
    expect(asTechnician.participantShares.map((share) => share.shareCents)).toEqual([100_000, 65_000]);
  });
});
