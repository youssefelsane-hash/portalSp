import assert from 'node:assert/strict';
import test from 'node:test';
import { nextPricingSliderStep, pricingSliderState } from '../src/lib/pricing-slider.ts';

const field = (changes = {}) => ({ min_value: 0, max_value: 10, default_value: null, is_required: false, ...changes });

test('0-10 integer slider behaves like the customer-app quantity stepper', () => {
  const state = pricingSliderState(field(), undefined);
  assert.deepEqual(state, { min: 0, max: 10, integer: true, stepper: true, current: 0 });
  assert.equal(nextPricingSliderStep(0, 0, 10, 1), 1);
  assert.equal(nextPricingSliderStep(10, 0, 10, 1), 10);
  assert.equal(nextPricingSliderStep(0, 0, 10, -1), 0);
});

test('required untouched stepper is not presented as an answered zero', () => {
  const state = pricingSliderState(field({ is_required: true }), undefined);
  assert.equal(state.current, null);
  assert.equal(nextPricingSliderStep(null, 0, 10, 1), 1);
});

test('explicit default and explicit user value are displayed correctly', () => {
  assert.equal(pricingSliderState(field({ default_value: '3' }), undefined).current, 3);
  assert.equal(pricingSliderState(field({ default_value: '3' }), 5).current, 5);
});

test('large integer ranges stay stepped; decimal ranges remain continuous', () => {
  assert.deepEqual(pricingSliderState(field({ min_value: 0, max_value: 100 }), 1.9639), {
    min: 0, max: 100, integer: true, stepper: false, current: 2,
  });
  assert.deepEqual(pricingSliderState(field({ min_value: 0.5, max_value: 10.5 }), 1.9639), {
    min: 0.5, max: 10.5, integer: false, stepper: false, current: 1.9639,
  });
});
