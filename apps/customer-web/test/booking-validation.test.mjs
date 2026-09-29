import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bookingAnchorId,
  firstMissingUpTo,
  missingPricingFields,
  pricingFieldMissingMessage,
} from '../src/lib/booking-validation.ts';

// docs/08 §185 — الويب: التحقق بيقول **إيه** ناقص و**فين**، بترتيب الشاشة.

const field = (key, type, order, extra = {}) => ({
  id: `id-${key}`,
  field_key: key,
  label_ar: `سؤال ${key}`,
  field_type: type,
  is_required: true,
  display_order: order,
  unit_ar: null,
  options: null,
  min_value: null,
  max_value: null,
  min_files: null,
  max_files: null,
  ...extra,
});

test('الناقص بترتيب display_order مش بترتيب المصفوفة', () => {
  const items = missingPricingFields([field('b', 'number', 2), field('a', 'dropdown', 1)], {});
  assert.deepEqual(items.map((i) => i.key), ['field:a', 'field:b']);
  assert.equal(items[0].message, 'اختار «سؤال a» علشان نقدر نحسب السعر.');
  assert.equal(items[1].message, 'اكتب «سؤال b» علشان نقدر نحسب السعر.');
});

test('الاختياري مش ناقص، والصفر إجابة', () => {
  const items = missingPricingFields(
    [field('opt', 'number', 1, { is_required: false }), field('rooms', 'number', 2)],
    { rooms: 0 },
  );
  assert.deepEqual(items, []);
});

test('الصور بعددها', () => {
  const images = field('photos', 'image_upload', 1, { min_files: 2 });
  assert.equal(missingPricingFields([images], { photos: 'one' }).length, 1);
  assert.equal(missingPricingFields([images], { photos: 'one,two' }).length, 0);
  assert.equal(pricingFieldMissingMessage(images), 'ارفع 2 صور على الأقل في «سؤال photos» علشان نقدر نحسب السعر.');
});

test('أول ناقص لحد الخطوة: الموعد في الخطوة ٢ مايوقفش الخطوة ١', () => {
  const items = [
    { key: 'schedule', step: 2, message: 'حدد الموعد المناسب قبل اختيار مقدم الخدمة.' },
    { key: 'policies', step: 3, message: 'x' },
  ];
  assert.equal(firstMissingUpTo(items, 1), null);
  assert.equal(firstMissingUpTo(items, 2)?.key, 'schedule');
  assert.equal(firstMissingUpTo(items, 3)?.key, 'schedule');
});

test('معرّف الـDOM آمن لأي مفتاح حقل', () => {
  assert.equal(bookingAnchorId('field:shirts_count'), 'booking-field-shirts_count');
  assert.equal(bookingAnchorId('address'), 'booking-address');
});
