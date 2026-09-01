export interface SettlementRefundBucket {
  bucketType: 'platform' | 'participant';
  technicianId: string | null;
  originalCents: number;
}

export interface SettlementRefundReversal extends SettlementRefundBucket {
  reversalCents: number;
}

/**
 * Calculates the delta between two cumulative refund states from immutable settlement buckets.
 * Largest-remainder allocation makes repeated partial refunds telescope to the exact full refund.
 */
export function allocateSettlementRefundReversal(input: {
  orderTotalCents: number;
  previouslyRefundedCents: number;
  currentRefundCents: number;
  buckets: SettlementRefundBucket[];
}): SettlementRefundReversal[] {
  const orderTotal = money('orderTotalCents', input.orderTotalCents);
  const previous = money('previouslyRefundedCents', input.previouslyRefundedCents);
  const current = money('currentRefundCents', input.currentRefundCents);
  if (orderTotal <= 0) throw new Error('Refund allocation requires a positive original order total');
  if (previous + current > orderTotal) throw new Error('Cumulative refund cannot exceed the original order total');

  const bucketTotal = input.buckets.reduce((sum, bucket) => sum + money('originalCents', bucket.originalCents), 0);
  if (bucketTotal !== orderTotal) {
    throw new Error('Settlement refund buckets must equal the original order total');
  }

  const previousTargets = cumulativeTargets(previous, orderTotal, input.buckets);
  const nextTargets = cumulativeTargets(previous + current, orderTotal, input.buckets);
  const reversals = input.buckets.map((bucket, index) => ({
    ...bucket,
    reversalCents: nextTargets[index] - previousTargets[index],
  }));

  if (reversals.reduce((sum, reversal) => sum + reversal.reversalCents, 0) !== current) {
    throw new Error('Settlement refund reversal does not equal the current refund');
  }
  return reversals;
}

function cumulativeTargets(
  cumulativeRefundCents: number,
  orderTotalCents: number,
  buckets: SettlementRefundBucket[],
): number[] {
  const total = BigInt(orderTotalCents);
  const cumulative = BigInt(cumulativeRefundCents);
  const rows = buckets.map((bucket, index) => {
    const numerator = cumulative * BigInt(bucket.originalCents);
    return {
      index,
      floor: numerator / total,
      fraction: numerator % total,
      key: bucket.bucketType === 'platform' ? '0:platform' : `1:${bucket.technicianId ?? ''}`,
    };
  });
  const distributed = rows.reduce((sum, row) => sum + row.floor, 0n);
  const remainder = Number(cumulative - distributed);
  const order = [...rows].sort((left, right) => {
    if (left.fraction !== right.fraction) return left.fraction > right.fraction ? -1 : 1;
    return left.key.localeCompare(right.key);
  });
  for (let index = 0; index < remainder; index += 1) order[index].floor += 1n;
  return rows.sort((left, right) => left.index - right.index).map((row) => Number(row.floor));
}

function money(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be non-negative integer piasters`);
  return value;
}
