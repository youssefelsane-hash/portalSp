import assert from 'node:assert/strict';
import test from 'node:test';
import { describeCustomerInput } from '../../../packages/shared-types/src/customer-inputs.ts';

/**
 * عرض اختيارات العميل في صفحة الطلب (docs/08 §185) — نفس قواعد `customer_inputs.dart` في تطبيق الفني.
 */
test('عدّاد صحيح مسجّل بكسر بيتعرض مقرّب ومعاه القيمة المخزّنة', () => {
  const shown = describeCustomerInput({
    key: 'shirts', label: 'عدد القمصان', value: '1.9639846991701237', unit: 'قميص', integer_quantity: true,
  });
  assert.equal(shown.value, '2 قميص');
  assert.equal(shown.storedValue, '1.9639846991701237');
});

test('قيمة صحيحة أصلاً مالهاش storedValue', () => {
  const shown = describeCustomerInput({ key: 'k', label: 'عدد', value: '3', unit: 'قطعة', integer_quantity: true });
  assert.equal(shown.value, '3 قطعة');
  assert.equal(shown.storedValue, null);
});

test('شرح الأدمن الطويل في unit مابيتكتبش جنب القيمة', () => {
  const shown = describeCustomerInput({
    key: 't', label: 'عدد التيشيرتات', value: '0', unit: '(حدد إجمالي عدد التيشيرتات والبولو في الطلب.)',
  });
  assert.equal(shown.value, '0');
});

test('الافتراضي بيتطوي بس لحقل اختياري عليه metadata من السيرفر', () => {
  assert.equal(describeCustomerInput({ key: 'a', label: 'a', value: 'x', is_default: true, is_required: false }).isDefault, true);
  assert.equal(describeCustomerInput({ key: 'b', label: 'b', value: 'x', is_default: true, is_required: true }).isDefault, false);
});

test('بند قديم بلا metadata: لا تقريب ولا ادعاء افتراضي', () => {
  const shown = describeCustomerInput({ key: 'shirts', label: 'عدد القمصان', value: '1.5', unit: 'قميص' });
  assert.equal(shown.value, '1.5 قميص');
  assert.equal(shown.isDefault, false);
  assert.equal(shown.storedValue, null);
});
