export const INSTAPAY_REWARD_RATE_PERCENT = 5;

/** The configured EGP amount is a cap, not a flat discount. */
export function calculateInstaPayRewardCents(amountDueCents: number, capCents: number): number {
  if (!Number.isSafeInteger(amountDueCents) || amountDueCents <= 0 || !Number.isSafeInteger(capCents) || capCents <= 0) {
    return 0;
  }
  const rewardCents = Math.min(
    Math.round(amountDueCents * INSTAPAY_REWARD_RATE_PERCENT / 100),
    capCents,
  );
  return rewardCents < amountDueCents ? rewardCents : 0;
}
