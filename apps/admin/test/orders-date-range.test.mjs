import assert from 'node:assert/strict';
import test from 'node:test';
import { cairoDay, matchingOrdersPreset, ordersDateRange } from '../src/lib/orders-date-range.mjs';

test('a date range uses Cairo today even when the browser is still on yesterday', () => {
  const now = new Date('2026-10-03T21:30:00Z');
  assert.equal(cairoDay(now), '2026-10-04');
  assert.deepEqual(ordersDateRange(1, now), { from: '2026-10-04', to: '2026-10-04' });
  assert.deepEqual(ordersDateRange(7, now), { from: '2026-10-04', to: '2026-10-10' });
  assert.deepEqual(ordersDateRange(30, now), { from: '2026-10-04', to: '2026-11-02' });
});

test('preset selection matches only ranges starting today', () => {
  const now = new Date('2026-10-03T21:30:00Z');
  assert.equal(matchingOrdersPreset('2026-10-04', '2026-10-10', now), '7');
  assert.equal(matchingOrdersPreset('2026-10-04', '2026-10-11', now), '');
  assert.equal(matchingOrdersPreset('2026-09-01', '2026-09-07', now), '');
});
