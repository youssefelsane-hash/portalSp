import assert from 'node:assert/strict';
import test from 'node:test';
import { pricingFieldDefaultError, pricingFieldDefaultPayload } from '../src/app/catalog/services/[id]/pricing-field-default.ts';

for (const field_type of ['number', 'slider', 'area', 'length', 'volume']) {
  test(`${field_type}: zero and bounds are valid; out-of-range defaults are rejected`, () => {
    const field = { field_type, min_value: 0, max_value: 100 };
    for (const value of ['0', '3', '100']) {
      assert.equal(pricingFieldDefaultError({ ...field, default_value: value }), null);
    }
    for (const value of ['-1', '101', 'NaN', 'Infinity']) {
      assert.ok(pricingFieldDefaultError({ ...field, default_value: value }));
    }
  });
}

test('numeric defaults honor one-sided bounds and decimals', () => {
  assert.equal(pricingFieldDefaultError({ field_type: 'slider', default_value: '1.5', min_value: 1 }), null);
  assert.ok(pricingFieldDefaultError({ field_type: 'slider', default_value: '3', max_value: 2 }));
});

test('save preserves zero and false, while clearing sends null rather than omitting the patch', () => {
  assert.equal(pricingFieldDefaultPayload('0'), '0');
  assert.equal(pricingFieldDefaultPayload('false'), 'false');
  for (const value of ['', '   ', undefined]) assert.equal(pricingFieldDefaultPayload(value), null);
  assert.equal(JSON.stringify({ default_value: pricingFieldDefaultPayload('') }), '{"default_value":null}');
});

test('checkbox and option defaults are not treated as numbers', () => {
  assert.equal(pricingFieldDefaultError({ field_type: 'checkbox', default_value: 'false' }), null);
  assert.equal(pricingFieldDefaultError({ field_type: 'dropdown', default_value: 'large' }), null);
});
