import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isValidPhoneInput,
  phoneNumberForApi,
  phoneNumberForDisplay,
} from '../../../packages/shared-types/src/phone.ts';

// نفس حالات `apps/customer-app/test/phone_number_test.dart` — القاعدة لازم تبقى واحدة على الويب والتطبيق.
test('الرقم المحلي بيتحوّل لنفس هوية الحساب E.164', () => {
  for (const prefix of ['010', '011', '012', '015']) {
    assert.equal(phoneNumberForApi(`${prefix}12345678`), `+20${prefix.slice(1)}12345678`);
  }
  assert.equal(phoneNumberForApi(' 010 1234-5678 '), '+201012345678');
});

test('الأرقام الدولية الحالية شغالة زي ما هي', () => {
  assert.equal(phoneNumberForApi('+201012345678'), '+201012345678');
  assert.equal(isValidPhoneInput('+971501234567'), true);
});

test('رقم ناقص أو بادئة مش مدعومة مايعدّيش', () => {
  assert.equal(isValidPhoneInput('0101234567'), false);
  assert.equal(isValidPhoneInput('01312345678'), false);
  assert.equal(isValidPhoneInput(''), false);
});

test('العرض بيرجّع الشكل المحلي', () => {
  assert.equal(phoneNumberForDisplay('+201512345678'), '01512345678');
  assert.equal(phoneNumberForDisplay('+971501234567'), '+971501234567');
});
