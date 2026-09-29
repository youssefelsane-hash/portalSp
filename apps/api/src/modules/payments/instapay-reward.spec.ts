import { calculateInstaPayRewardCents } from './instapay-reward';

describe('InstaPay reward percentage and configured cap', () => {
  it('uses five percent for a 300 EGP payment under a 30 EGP cap', () => {
    expect(calculateInstaPayRewardCents(30_000, 3_000)).toBe(1_500);
  });

  it('caps a 1000 EGP payment at 30 EGP', () => {
    expect(calculateInstaPayRewardCents(100_000, 3_000)).toBe(3_000);
  });

  it('does not produce a free payment or a reward when disabled', () => {
    expect(calculateInstaPayRewardCents(1, 3_000)).toBe(0);
    expect(calculateInstaPayRewardCents(30_000, 0)).toBe(0);
  });
});
