import assert from 'node:assert/strict';
import test from 'node:test';
import { displayOrderCustomerInput, splitOrderCustomerInputs } from '../src/lib/order-customer-inputs.ts';

const item = (overrides = {}) => ({ key: 'shirts', label: 'قمصان', value: '0', unit: null, ...overrides });

test('optional defaults are separated without hiding required zero or older snapshots', () => {
  const legacy = item({ key: 'legacy' });
  const required = item({ key: 'required', is_default: true, is_required: true });
  const defaulted = item({ key: 'defaulted', is_default: true, is_required: false });
  const selected = item({ key: 'selected', is_default: false });
  const summary = splitOrderCustomerInputs([legacy, required, defaulted, selected]);
  assert.deepEqual(summary.meaningful.map((input) => input.key), ['legacy', 'required', 'selected']);
  assert.deepEqual(summary.defaults.map((input) => input.key), ['defaulted']);
});

test('integer quantities follow technician display without losing decimal or long explanations', () => {
  assert.deepEqual(displayOrderCustomerInput(item({ value: '1.9639', unit: 'قطعة', integer_quantity: true })), {
    value: '2 قطعة', explanation: null,
  });
  assert.deepEqual(displayOrderCustomerInput(item({ value: '1.9639', unit: 'حدد عدد القمصان التي ترغب في كيها', integer_quantity: false })), {
    value: '1.9639', explanation: 'حدد عدد القمصان التي ترغب في كيها',
  });
});
