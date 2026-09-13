import { allocateSettlementRefundReversal, SettlementRefundBucket } from './settlement-refund-allocation';

const buckets: SettlementRefundBucket[] = [
  { bucketType: 'platform', technicianId: null, originalCents: 20_000 },
  { bucketType: 'participant', technicianId: 'lead', originalCents: 50_000 },
  { bucketType: 'participant', technicianId: 'assistant', originalCents: 30_000 },
];

describe('V2 settlement refund allocation', () => {
  it('reverses every original bucket proportionally', () => {
    const result = allocateSettlementRefundReversal({
      orderTotalCents: 100_000,
      previouslyRefundedCents: 0,
      currentRefundCents: 25_000,
      buckets,
    });
    expect(result.map((row) => row.reversalCents)).toEqual([5_000, 12_500, 7_500]);
  });

  it('telescopes repeated partial refunds to the exact immutable settlement', () => {
    const first = allocateSettlementRefundReversal({
      orderTotalCents: 100_000,
      previouslyRefundedCents: 0,
      currentRefundCents: 33_333,
      buckets,
    });
    const second = allocateSettlementRefundReversal({
      orderTotalCents: 100_000,
      previouslyRefundedCents: 33_333,
      currentRefundCents: 66_667,
      buckets,
    });
    expect(first.map((row, index) => row.reversalCents + second[index].reversalCents)).toEqual([
      20_000,
      50_000,
      30_000,
    ]);
  });

  it('allocates every rounding piaster deterministically', () => {
    const result = allocateSettlementRefundReversal({
      orderTotalCents: 3,
      previouslyRefundedCents: 0,
      currentRefundCents: 1,
      buckets: [
        { bucketType: 'platform', technicianId: null, originalCents: 1 },
        { bucketType: 'participant', technicianId: 'a', originalCents: 1 },
        { bucketType: 'participant', technicianId: 'b', originalCents: 1 },
      ],
    });
    expect(result.map((row) => row.reversalCents)).toEqual([1, 0, 0]);
  });

  it('rejects incomplete or inflated bucket snapshots', () => {
    expect(() =>
      allocateSettlementRefundReversal({
        orderTotalCents: 100_001,
        previouslyRefundedCents: 0,
        currentRefundCents: 1,
        buckets,
      }),
    ).toThrow('buckets must equal');
  });

  it('makes 10% + 20% + 30% + 40% identical to one full refund', () => {
    const original: SettlementRefundBucket[] = [
      { bucketType: 'platform', technicianId: null, originalCents: 50_001 },
      { bucketType: 'participant', technicianId: 'a', originalCents: 299_999 },
      { bucketType: 'participant', technicianId: 'b', originalCents: 150_003 },
      { bucketType: 'participant', technicianId: 'c', originalCents: 73_454 },
    ];
    const total = original.reduce((sum, bucket) => sum + bucket.originalCents, 0);
    const steps = [10, 20, 30, 40].map((percentage) => Math.floor((total * percentage) / 100));
    steps[steps.length - 1] += total - steps.reduce((sum, value) => sum + value, 0);
    let previous = 0;
    const accumulated = new Array(original.length).fill(0) as number[];
    for (const current of steps) {
      const reversals = allocateSettlementRefundReversal({
        orderTotalCents: total,
        previouslyRefundedCents: previous,
        currentRefundCents: current,
        buckets: original,
      });
      reversals.forEach((row, index) => { accumulated[index] += row.reversalCents; });
      previous += current;
    }
    const once = allocateSettlementRefundReversal({
      orderTotalCents: total,
      previouslyRefundedCents: 0,
      currentRefundCents: total,
      buckets: original,
    });
    expect(accumulated).toEqual(once.map((row) => row.reversalCents));
    expect(accumulated).toEqual(original.map((bucket) => bucket.originalCents));
  });

  it.each([1, 25, 33, 50, 99])('allocates a %i%% refund exactly', (percentage) => {
    const original: SettlementRefundBucket[] = [
      { bucketType: 'platform', technicianId: null, originalCents: 12_345 },
      { bucketType: 'participant', technicianId: 'lead', originalCents: 54_321 },
      { bucketType: 'participant', technicianId: 'assistant', originalCents: 33_335 },
    ];
    const total = original.reduce((sum, bucket) => sum + bucket.originalCents, 0);
    const refund = Math.floor((total * percentage) / 100);
    const result = allocateSettlementRefundReversal({
      orderTotalCents: total,
      previouslyRefundedCents: 0,
      currentRefundCents: refund,
      buckets: original,
    });
    expect(result.reduce((sum, row) => sum + row.reversalCents, 0)).toBe(refund);
    expect(result.every((row) => row.reversalCents <= row.originalCents)).toBe(true);
  });

  it('reverses a platform-funded discount without leaving technician money behind', () => {
    const subsidized: SettlementRefundBucket[] = [
      { bucketType: 'platform', technicianId: null, originalCents: -1_200 },
      { bucketType: 'participant', technicianId: 'lead', originalCents: 10_200 },
    ];
    const first = allocateSettlementRefundReversal({
      orderTotalCents: 9_000,
      previouslyRefundedCents: 0,
      currentRefundCents: 3_000,
      buckets: subsidized,
    });
    const final = allocateSettlementRefundReversal({
      orderTotalCents: 9_000,
      previouslyRefundedCents: 3_000,
      currentRefundCents: 6_000,
      buckets: subsidized,
    });

    expect(first.reduce((sum, row) => sum + row.reversalCents, 0)).toBe(3_000);
    expect(final.reduce((sum, row) => sum + row.reversalCents, 0)).toBe(6_000);
    expect(first.map((row, index) => row.reversalCents + final[index].reversalCents)).toEqual([
      -1_200,
      10_200,
    ]);
  });

  it('never permits a negative participant settlement bucket', () => {
    expect(() =>
      allocateSettlementRefundReversal({
        orderTotalCents: 9_000,
        previouslyRefundedCents: 0,
        currentRefundCents: 1_000,
        buckets: [
          { bucketType: 'platform', technicianId: null, originalCents: 10_000 },
          { bucketType: 'participant', technicianId: 'lead', originalCents: -1_000 },
        ],
      }),
    ).toThrow('participant originalCents must be non-negative');
  });
});
