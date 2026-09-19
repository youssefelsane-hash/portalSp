import assert from 'node:assert/strict';
import test from 'node:test';
import { isProviderDiscoveryReady, providerEligibilityKey } from '../src/lib/provider-discovery.ts';

/**
 * **الفلو بتاع «اختار المنفّذ بنفسك» — إمتى نسأل، وإمتى القايمة القديمة تبطل.**
 *
 * بلاغ المالك 2026-09-19: الشاشة كانت بتقول «مفيش فنيين متاحين في منطقتك دلوقتي للخدمة دي»
 * قبل ما العميل يختار أي ميعاد، لأن الجلب كان بينطلق أول ما الوضع يبقى يدوي ويبقى فيه عنوان.
 */

const base = {
  allowsScheduling: true,
  schedulePrecision: 'full_day',
  scheduleDayMode: 'specific',
  scheduledDate: '',
  scheduledDateRangeEnd: '',
  preciseTime: '',
  isSameDayBooking: false,
};

test('١: الوضع اليدوي قبل اختيار أي تاريخ — السؤال ماينفعش يتسأل', () => {
  assert.equal(isProviderDiscoveryReady(base), false);
  assert.equal(isProviderDiscoveryReady({ ...base, schedulePrecision: 'start_time' }), false);
});

test('٢: خدمة `start_time` بتاريخ من غير ساعة — القايمة تستنى الساعة', () => {
  const dateOnly = { ...base, schedulePrecision: 'start_time', scheduledDate: '2027-11-01' };
  assert.equal(isProviderDiscoveryReady(dateOnly), false);
  assert.equal(isProviderDiscoveryReady({ ...dateOnly, preciseTime: '14:00' }), true);
});

test('٣: خدمة يوم كامل بتاريخ لوحده جاهزة — الساعة مش جزء من حجزها أصلاً', () => {
  assert.equal(isProviderDiscoveryReady({ ...base, scheduledDate: '2027-11-01' }), true);
});

test('المدى المرن محتاج طرفيه — طرف واحد مش سياق حجز كامل', () => {
  const start = { ...base, scheduleDayMode: 'flexible', scheduledDate: '2027-11-01' };
  assert.equal(isProviderDiscoveryReady(start), false);
  assert.equal(isProviderDiscoveryReady({ ...start, scheduledDateRangeEnd: '2027-11-05' }), true);
});

test('الطوارئ/ASAP مالهاش علاقة بالبوابة — غياب الميعاد فيها مقصود', () => {
  // نفس اليوم = طوارئ حقيقية، و`scheduled_at = null` هناك معناها «دلوقتي» عن قصد.
  assert.equal(isProviderDiscoveryReady({ ...base, isSameDayBooking: true }), true);
  // خدمة مابتقبلش جدولة مفيش ليها ميعاد أصلاً.
  assert.equal(isProviderDiscoveryReady({ ...base, allowsScheduling: false }), true);
});

test('٦: أي مدخل بيغيّر الأهلية بيغيّر البصمة — فالقايمة والاختيار بيتصفّروا', () => {
  const ctx = {
    ...base,
    schedulePrecision: 'start_time',
    scheduledDate: '2027-11-01',
    preciseTime: '14:00',
    addressId: 'addr-1',
    pricingModel: 'formula',
    fieldValues: { days: 3 },
  };
  const key = providerEligibilityKey(ctx);
  assert.notEqual(providerEligibilityKey({ ...ctx, addressId: 'addr-2' }), key, 'تغيير العنوان');
  assert.notEqual(providerEligibilityKey({ ...ctx, scheduledDate: '2027-11-02' }), key, 'تغيير التاريخ');
  assert.notEqual(providerEligibilityKey({ ...ctx, preciseTime: '16:00' }), key, 'تغيير الساعة');
  assert.notEqual(providerEligibilityKey({ ...ctx, scheduledDateRangeEnd: '2027-11-09' }), key, 'تغيير المدى');
  assert.notEqual(providerEligibilityKey({ ...ctx, fieldValues: { days: 30 } }), key, 'تغيير حقول الشغل');
  // نفس المدخلات بكائن جديد = نفس البصمة: الجلب مابيتكررش على كل رندر بلا داعي.
  assert.equal(providerEligibilityKey({ ...ctx, fieldValues: { days: 3 } }), key);
});

test('حقول الشغل مالهاش أثر على الأهلية في خدمة مش formula', () => {
  const ctx = { ...base, scheduledDate: '2027-11-01', addressId: 'a', pricingModel: 'inspection_then_quote', fieldValues: { days: 3 } };
  assert.equal(providerEligibilityKey(ctx), providerEligibilityKey({ ...ctx, fieldValues: { days: 99 } }));
});
