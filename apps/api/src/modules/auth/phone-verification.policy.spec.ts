// **سياسة تحقّق الرقم عند أول طلب** (ADR-0112) — الشرط نفسه اللي البوابة ومسار التحقّق بيشاركوه.
//
// الاختبار ده بيحمي أهم خاصية في القرار: **مفيش حالة جديدة**. `users.phone_verified_at` لوحده
// بيعطي «أول طلب بس» — فأي محاولة مستقبلية تضيف عمود/جدول للعدّ هتكسر الاختبارات دي.
import {
  needsPhoneVerification,
  phoneVerificationRequiredError,
  REQUIRE_PHONE_VERIFICATION_SETTING,
} from './phone-verification.policy';

describe('سياسة تحقّق الرقم عند أول طلب (ADR-0112)', () => {
  it('المفتاح مقفول ⇒ عمره ما يطلب تحقّق، مهما كانت حالة الرقم', () => {
    expect(needsPhoneVerification(null, false)).toBe(false);
    expect(needsPhoneVerification(new Date(), false)).toBe(false);
  });

  it('المفتاح مفعّل + رقم مش متحقَّق منه ⇒ مطلوب', () => {
    expect(needsPhoneVerification(null, true)).toBe(true);
    expect(needsPhoneVerification(undefined, true)).toBe(true);
  });

  it('**الحسابات اللي سجّلت بالـOTP مابتتسألش** — صفر إزعاج للمستخدمين الحاليين', () => {
    // ADR-0109 §4: التسجيل بالرمز بيسيب العمود NULL، والتسجيل القديم بالـOTP كان بيحطّه.
    // فالعمود ده **بالفعل** بيفرّق بين الاتنين بلا أي حالة جديدة.
    expect(needsPhoneVerification(new Date('2026-01-01'), true)).toBe(false);
  });

  it('أول تحقّق ناجح بيخلّي كل الطلبات اللي بعده تمرّ — «أول طلب بس» مجانًا', () => {
    expect(needsPhoneVerification(null, true)).toBe(true);
    expect(needsPhoneVerification(new Date(), true)).toBe(false);
  });

  it('الرفض بيحمل سبب آلي ثابت عشان التطبيق يفتح الشاشة الصح', () => {
    const err = phoneVerificationRequiredError();
    expect(err.code).toBe('AUTH_009');
    expect(err.reason).toBe('phone_verification_required');
    expect(err.getStatus()).toBe(403);
  });

  it('مفتاح الإعداد مكتوب مرة واحدة — مفيش نص حرفي متكرر في المستهلكين', () => {
    expect(REQUIRE_PHONE_VERIFICATION_SETTING).toBe('orders.require_phone_verification_on_first_order');
  });
});
