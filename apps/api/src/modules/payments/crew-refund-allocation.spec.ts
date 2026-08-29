import { allocateCrewRefundReversal } from './crew-refund-allocation';

const shares = [
  { technicianId: 'leader', participantRole: 'leader' as const, shareCents: 60_001 },
  { technicianId: 'member', participantRole: 'team_member' as const, shareCents: 25_000 },
  { technicianId: 'assistant', participantRole: 'assistant' as const, shareCents: 15_000 },
];

describe('allocateCrewRefundReversal', () => {
  it('distributes a partial refund across everyone who earned from the order', () => {
    const result = allocateCrewRefundReversal({
      grossPoolCents: 100_001,
      orderTotalCents: 200_000,
      previouslyRefundedCents: 0,
      currentRefundCents: 50_000,
      shares,
    });

    expect(result.reduce((sum, row) => sum + row.reversalCents, 0)).toBe(25_000);
    expect(result.every((row) => row.reversalCents > 0)).toBe(true);
  });

  it('repeated partial refunds telescope to the exact original shares', () => {
    const first = allocateCrewRefundReversal({
      grossPoolCents: 100_001,
      orderTotalCents: 200_000,
      previouslyRefundedCents: 0,
      currentRefundCents: 73_333,
      shares,
    });
    const second = allocateCrewRefundReversal({
      grossPoolCents: 100_001,
      orderTotalCents: 200_000,
      previouslyRefundedCents: 73_333,
      currentRefundCents: 126_667,
      shares,
    });

    for (const share of shares) {
      const reversed =
        first.find((row) => row.technicianId === share.technicianId)!.reversalCents +
        second.find((row) => row.technicianId === share.technicianId)!.reversalCents;
      expect(reversed).toBe(share.shareCents);
    }
  });

  it('returns no movement for a free order or an empty crew', () => {
    expect(
      allocateCrewRefundReversal({
        grossPoolCents: 0,
        orderTotalCents: 0,
        previouslyRefundedCents: 0,
        currentRefundCents: 100,
        shares,
      }),
    ).toEqual([]);
  });
});
