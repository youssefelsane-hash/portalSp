export interface RefundShareInput {
  technicianId: string;
  participantRole: 'leader' | 'team_member' | 'assistant';
  shareCents: number;
}

export interface RefundShareReversal extends RefundShareInput {
  reversalCents: number;
}

/**
 * Calculates the incremental crew reversal for one refund row.
 *
 * The calculation uses cumulative refund totals, then subtracts the previous target. This makes
 * repeated partial refunds telescope to the exact full share instead of accumulating rounding
 * drift. Any one-cent remainder is assigned to the leader, matching the original crew split.
 */
export function allocateCrewRefundReversal(input: {
  grossPoolCents: number;
  orderTotalCents: number;
  previouslyRefundedCents: number;
  currentRefundCents: number;
  shares: RefundShareInput[];
}): RefundShareReversal[] {
  if (input.shares.length === 0 || input.grossPoolCents <= 0 || input.orderTotalCents <= 0) return [];

  const orderTotal = Math.max(1, Math.trunc(input.orderTotalCents));
  const previousRefunded = Math.max(0, Math.min(orderTotal, Math.trunc(input.previouslyRefundedCents)));
  const refundedAfter = Math.max(
    previousRefunded,
    Math.min(orderTotal, previousRefunded + Math.max(0, Math.trunc(input.currentRefundCents))),
  );
  const grossPool = Math.max(0, Math.trunc(input.grossPoolCents));
  const targetBefore = Math.round((grossPool * previousRefunded) / orderTotal);
  const targetAfter = Math.round((grossPool * refundedAfter) / orderTotal);
  const incrementalTarget = Math.max(0, targetAfter - targetBefore);

  const reversals = input.shares.map((share) => {
    const shareCents = Math.max(0, Math.trunc(share.shareCents));
    const before = Math.round((shareCents * previousRefunded) / orderTotal);
    const after = Math.round((shareCents * refundedAfter) / orderTotal);
    return { ...share, shareCents, reversalCents: Math.max(0, after - before) };
  });

  const distributed = reversals.reduce((sum, share) => sum + share.reversalCents, 0);
  const remainder = incrementalTarget - distributed;
  if (remainder !== 0) {
    const leaderIndex = reversals.findIndex((share) => share.participantRole === 'leader');
    const targetIndex = leaderIndex >= 0 ? leaderIndex : 0;
    reversals[targetIndex].reversalCents = Math.max(0, reversals[targetIndex].reversalCents + remainder);
  }

  return reversals;
}
