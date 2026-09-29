import assert from 'node:assert/strict';
import test from 'node:test';
import { whatsappChatUrl } from '../src/lib/whatsapp.ts';

// docs/08 §185 — رقم الدعم في الفوتر بيفتح محادثة واتساب مش `tel:`. الرابط بيتبني من الرقم اللي
// الأدمن كاتبه في بيانات الجهة، فلازم يستحمل كل الأشكال اللي ممكن يتكتب بيها.

test('الرقم الدولي بـ+ ومسافات ⇒ wa.me بالأرقام بس', () => {
  assert.equal(whatsappChatUrl('+201505988990'), 'https://wa.me/201505988990');
  assert.equal(whatsappChatUrl('+20 150 598 8990'), 'https://wa.me/201505988990');
  assert.equal(whatsappChatUrl('00201505988990'), 'https://wa.me/201505988990');
});

test('الرقم المحلي المصري وأرقام عربية', () => {
  assert.equal(whatsappChatUrl('01505988990'), 'https://wa.me/201505988990');
  assert.equal(whatsappChatUrl('٠١٥٠٥٩٨٨٩٩٠'), 'https://wa.me/201505988990');
});

test('رقم مايصلحش ⇒ null (الواجهة ترجع للاتصال بدل رابط بايظ)', () => {
  assert.equal(whatsappChatUrl(null), null);
  assert.equal(whatsappChatUrl(''), null);
  assert.equal(whatsappChatUrl('123'), null);
  assert.equal(whatsappChatUrl('javascript:alert(1)'), null);
});
