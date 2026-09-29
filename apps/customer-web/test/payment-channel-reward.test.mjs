import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentChannelRewardCents } from '../src/lib/payments.ts';

const channel = { method: 'instapay', discount_cents: 0, discount_rate_percent: 5, discount_cap_cents: 3000 };

test('InstaPay preview uses five percent of the current payment, capped by admin setting', () => {
  assert.equal(paymentChannelRewardCents(channel, 30000), 1500);
  assert.equal(paymentChannelRewardCents(channel, 100000), 3000);
  assert.equal(paymentChannelRewardCents(channel, null), 0);
});

test('non-InstaPay legacy fixed amount remains compatible', () => {
  assert.equal(paymentChannelRewardCents({ method: 'card', discount_cents: 500 }, 30000), 500);
});
