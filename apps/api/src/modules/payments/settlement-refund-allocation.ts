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

  const bucketTotal = input.buckets.reduce((sum, bucket) => {
    const original = bucket.bucketType === 'platform'
      ? signedMoney('platform originalCents', bucket.originalCents)
      : money('participant originalCents', bucket.originalCents);
    return sum + original;
  }, 0);
  if (bucketTotal !== orderTotal) {
    throw new Error('Settlement refund buckets must equal the original order total');
  }

  const hasPlatformSubsidy = input.buckets.some(
    (bucket) => bucket.bucketType === 'platform' && bucket.originalCents < 0,
  );
  const targetResolver = hasPlatformSubsidy ? cumulativeSubsidizedTargets : cumulativeTargets;
  const previousTargets = targetResolver(previous, orderTotal, input.buckets);
  const nextTargets = targetResolver(previous + current, orderTotal, input.buckets);
  const reversals = input.buckets.map((bucket, index) => ({
    ...bucket,
    reversalCents: nextTargets[index] - previousTargets[index],
  }));

  if (reversals.reduce((sum, reversal) => sum + reversal.reversalCents, 0) !== current) {
    throw new Error('Settlement refund reversal does not equal the current refund');
  }
  return reversals;
}

/**
 * A platform-funded discount creates a negative platform bucket and participant shares whose sum
 * is greater than the customer total. Participant reversals still telescope proportionally to
 * their complete immutable shares; the platform bucket is the exact residual, and can therefore
 * be negative. Keeping this separate preserves the original largest-remainder behavior for every
 * historical non-subsidized settlement.
 */
function cumulativeSubsidizedTargets(
  cumulativeRefundCents: number,
  orderTotalCents: number,
  buckets: SettlementRefundBucket[],
): number[] {
  const platformIndexes = buckets
    .map((bucket, index) => ({ bucket, index }))
    .filter(({ bucket }) => bucket.bucketType === 'platform');
  if (platformIndexes.length !== 1) {
    throw new Error('Subsidized settlement requires exactly one platform bucket');
  }

  const total = BigInt(orderTotalCents);
  const cumulative = BigInt(cumulativeRefundCents);
  const targets = buckets.map((bucket) =>
    bucket.bucketType === 'participant'
      ? Number((cumulative * BigInt(bucket.originalCents)) / total)
      : 0,
  );
  const participantTotal = targets.reduce((sum, target) => sum + target, 0);
  targets[platformIndexes[0].index] = cumulativeRefundCents - participantTotal;
  return targets;
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

function signedMoney(name: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be integer piasters`);
  return value;
}
