import { calculateEarningsV2, EarningsParticipantInput } from './earnings-calculator';
import { allocateSettlementRefundReversal } from './settlement-refund-allocation';

const participant = (
  technicianId: string,
  options: Partial<EarningsParticipantInput> = {},
): EarningsParticipantInput => ({
  technicianId,
  earningRole: 'technician',
  isLeader: technicianId === 'lead',
  technicianKindSnapshot: 'technician',
  technicianLevel: 'professional',
  levelWeightBps: 12_500,
  assistantRatioBps: 7_600,
  serviceSkill: 'standard',
  serviceSkillFactorBps: 10_000,
  ...options,
});

describe('Unified Workforce Earnings Engine V2', () => {
  it('deducts the fixed platform commission once and gives a lone technician the exact pool', () => {
    const result = calculateEarningsV2(100_000, 12_000, [participant('lead')]);

    expect(result.platformCommissionCents).toBe(12_000);
    expect(result.workerPoolCents).toBe(88_000);
    expect(result.participantShares[0].shareCents).toBe(88_000);
  });

  it('uses the assistant ratio at the same career level without a separate wage path', () => {
    const result = calculateEarningsV2(176_000, 0, [
      participant('lead'),
      participant('assistant', {
        earningRole: 'assistant',
        technicianKindSnapshot: 'assistant',
        isLeader: false,
      }),
    ]);

    expect(result.participantShares.map((share) => share.shareCents)).toEqual([100_000, 76_000]);
  });

  it('combines level, role, skill, individual, and order policy factors', () => {
    const result = calculateEarningsV2(330_000, 30_000, [
      participant('lead', { levelWeightBps: 10_000 }),
      participant('expert', {
        isLeader: false,
        levelWeightBps: 10_000,
        serviceSkill: 'expert',
        serviceSkillFactorBps: 11_000,
        individualAdjustmentBps: 1_000,
        orderAdjustmentBps: 1_000,
      }),
    ]);

    expect(result.participantShares[1].shareCents).toBeGreaterThan(result.participantShares[0].shareCents);
    expect(result.participantShares.reduce((sum, share) => sum + share.shareCents, 0)).toBe(300_000);
  });

  it('distributes rounding cents by largest remainder with a stable technician-id tie break', () => {
    const result = calculateEarningsV2(100, 0, [
      participant('lead', { levelWeightBps: 10_000 }),
      participant('a', { isLeader: false, levelWeightBps: 10_000 }),
      participant('b', { isLeader: false, levelWeightBps: 10_000 }),
    ]);

    expect(result.participantShares.map((share) => [share.technicianId, share.shareCents])).toEqual([
      ['lead', 33],
      ['a', 34],
      ['b', 33],
    ]);
  });

  it('supports a free warranty revisit without creating earnings or commission', () => {
    const result = calculateEarningsV2(0, 0, [participant('lead')]);
    expect(result.workerPoolCents).toBe(0);
    expect(result.participantShares[0].shareCents).toBe(0);
  });

  it('rejects commission larger than the final customer total', () => {
    expect(() => calculateEarningsV2(10_000, 10_001, [participant('lead')])).toThrow(
      'commission cannot exceed',
    );
  });

  it('rejects duplicate participants rather than paying the same person twice', () => {
    expect(() => calculateEarningsV2(10_000, 0, [participant('lead'), participant('lead')])).toThrow(
      'Duplicate V2 participant',
    );
  });

  it('rejects an assistant leader and a crew without one technician leader', () => {
    expect(() =>
      calculateEarningsV2(10_000, 0, [
        participant('lead', { earningRole: 'assistant', technicianKindSnapshot: 'assistant' }),
      ]),
    ).toThrow('assistant cannot lead');

    expect(() => calculateEarningsV2(10_000, 0, [participant('member', { isLeader: false })])).toThrow(
      'exactly one leader',
    );
  });

  it('rejects a positive worker pool with no participants instead of silently losing money', () => {
    expect(() => calculateEarningsV2(10_000, 1_000, [])).toThrow('requires at least one participant');
  });

  it('treats a technician profile working as an assistant by its order earning role', () => {
    const result = calculateEarningsV2(165_000, 0, [
      participant('lead', { levelWeightBps: 10_000 }),
      participant('tech-helping', {
        isLeader: false,
        earningRole: 'assistant',
        technicianKindSnapshot: 'technician',
        levelWeightBps: 10_000,
        assistantRatioBps: 6_500,
      }),
    ]);
    expect(result.participantShares.map((share) => share.shareCents)).toEqual([100_000, 65_000]);
  });

  it('supports commission equal to total without creating worker money', () => {
    const result = calculateEarningsV2(50_000, 50_000, [participant('lead')]);
    expect(result.workerPoolCents).toBe(0);
    expect(result.participantShares[0].shareCents).toBe(0);
  });

  it('allows bounded adjustments without changing platform commission', () => {
    const baseline = calculateEarningsV2(500_000, 50_000, [
      participant('lead'),
      participant('member', { isLeader: false }),
    ]);
    const changed = calculateEarningsV2(500_000, 50_000, [
      participant('lead', { levelWeightBps: 16_000, serviceSkillFactorBps: 11_000 }),
      participant('member', {
        isLeader: false,
        earningRole: 'assistant',
        technicianKindSnapshot: 'assistant',
        levelWeightBps: 10_000,
        assistantRatioBps: 6_500,
        serviceSkillFactorBps: 9_500,
        individualAdjustmentBps: -2_500,
        orderAdjustmentBps: 1_500,
      }),
    ]);
    expect(changed.platformCommissionCents).toBe(baseline.platformCommissionCents);
    expect(changed.workerPoolCents).toBe(baseline.workerPoolCents);
    expect(changed.participantShares.map((share) => share.shareCents)).not.toEqual(
      baseline.participantShares.map((share) => share.shareCents),
    );
  });

  it('keeps the money invariant across a deterministic matrix of crews and awkward cents', () => {
    for (let seed = 1; seed <= 250; seed += 1) {
      const total = seed * 7_919 + (seed % 11);
      const commission = (seed * 997) % (total + 1);
      const crew = Array.from({ length: 1 + (seed % 12) }, (_, index) =>
        participant(index === 0 ? 'lead' : `member-${index.toString().padStart(2, '0')}`, {
          isLeader: index === 0,
          earningRole:
            index > 0 && ((index + seed) % 3 === 0 || (index + seed) % 4 === 0)
              ? 'assistant'
              : 'technician',
          technicianKindSnapshot: index > 0 && (index + seed) % 4 === 0 ? 'assistant' : 'technician',
          levelWeightBps: 10_000 + ((seed + index) % 6) * 1_250,
          assistantRatioBps: 6_000 + ((seed + index) % 7) * 500,
          serviceSkillFactorBps: 9_500 + ((seed + index) % 4) * 500,
          individualAdjustmentBps: ((seed + index) % 9 - 4) * 250,
          orderAdjustmentBps: ((seed * 3 + index) % 7 - 3) * 200,
        }),
      );
      const result = calculateEarningsV2(total, commission, crew);
      const shares = result.participantShares.reduce((sum, share) => sum + share.shareCents, 0);
      expect(shares).toBe(result.workerPoolCents);
      expect(result.platformCommissionCents + shares).toBe(total);
      expect(result.participantShares.every((share) => share.shareCents >= 0)).toBe(true);
    }
  });

  it('passes the 5,000 EGP Ahmed/Omar acceptance scenario and immutable refund history', () => {
    const settled = calculateEarningsV2(500_000, 50_000, [
      participant('ahmed', {
        isLeader: true,
        technicianLevel: 'professional',
        levelWeightBps: 12_500,
        serviceSkill: 'expert',
        serviceSkillFactorBps: 12_000,
      }),
      participant('omar', {
        isLeader: false,
        earningRole: 'assistant',
        technicianKindSnapshot: 'assistant',
        technicianLevel: 'verified',
        levelWeightBps: 11_000,
        assistantRatioBps: 7_000,
        serviceSkill: 'standard',
        serviceSkillFactorBps: 10_000,
        individualAdjustmentBps: 500,
      }),
    ]);

    expect(settled.platformCommissionCents).toBe(50_000);
    expect(settled.workerPoolCents).toBe(450_000);
    expect(settled.participantShares.map((share) => [share.technicianId, share.shareCents])).toEqual([
      ['ahmed', 292_398],
      ['omar', 157_602],
    ]);

    // A later promotion affects the next calculation only. `settled` is the immutable old snapshot.
    const nextOrder = calculateEarningsV2(500_000, 50_000, [
      participant('ahmed', {
        isLeader: true,
        levelWeightBps: 12_500,
        serviceSkill: 'expert',
        serviceSkillFactorBps: 12_000,
      }),
      participant('omar', {
        isLeader: false,
        earningRole: 'assistant',
        technicianKindSnapshot: 'assistant',
        technicianLevel: 'professional',
        levelWeightBps: 12_500,
        assistantRatioBps: 8_000,
        individualAdjustmentBps: 500,
      }),
    ]);
    expect(nextOrder.participantShares[1].shareCents).toBeGreaterThan(157_602);
    expect(settled.participantShares[1].shareCents).toBe(157_602);

    const buckets = [
      { bucketType: 'platform' as const, technicianId: null, originalCents: 50_000 },
      { bucketType: 'participant' as const, technicianId: 'ahmed', originalCents: 292_398 },
      { bucketType: 'participant' as const, technicianId: 'omar', originalCents: 157_602 },
    ];
    const firstFortyPercent = allocateSettlementRefundReversal({
      orderTotalCents: 500_000,
      previouslyRefundedCents: 0,
      currentRefundCents: 200_000,
      buckets,
    });
    const finalSixtyPercent = allocateSettlementRefundReversal({
      orderTotalCents: 500_000,
      previouslyRefundedCents: 200_000,
      currentRefundCents: 300_000,
      buckets,
    });

    expect(firstFortyPercent.map((row) => row.reversalCents)).toEqual([20_000, 116_959, 63_041]);
    expect(
      buckets.map((bucket, index) =>
        firstFortyPercent[index].reversalCents + finalSixtyPercent[index].reversalCents,
      ),
    ).toEqual(buckets.map((bucket) => bucket.originalCents));
  });
});
