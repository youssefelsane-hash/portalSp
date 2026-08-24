import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeServiceOptions } from '../src/app/warranty-plans/warranty-plan-services.ts';

const service = { id: 'service-1', name_ar: 'خدمة اختبار' };

test('accepts the current admin services array response', () => {
  assert.deepEqual(normalizeServiceOptions([service]), [service]);
});

test('accepts a paginated response without passing undefined to React state', () => {
  assert.deepEqual(normalizeServiceOptions({ items: [service] }), [service]);
});

test('falls back to an empty array for a malformed paginated response', () => {
  assert.deepEqual(normalizeServiceOptions({}), []);
});
