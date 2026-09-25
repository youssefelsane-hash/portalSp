// **سقف تسجيل الحسابات لكل IP** (`registrationThrottleLimit`).
//
// الاختبار ده بيحمي حاجتين مع بعض: إن الإنتاج **مستحيل** يتخفّف، وإن الاختبار يقدر يرفع السقف.
// بلا التانية، كل سويت اختبار حي (+٢٠ ملف بتسجّل عميل جديد من نفس الـlocalhost) بتاخد 429
// لأسباب مالهاش علاقة باللي بتقيسه.
import { REGISTRATION_THROTTLE_LIMIT_DEFAULT, registrationThrottleLimit } from './login-pin.policy';

describe('سقف تسجيل الحسابات لكل IP', () => {
  const original = process.env.AUTH_REGISTRATION_THROTTLE_LIMIT;
  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_REGISTRATION_THROTTLE_LIMIT;
    else process.env.AUTH_REGISTRATION_THROTTLE_LIMIT = original;
  });

  it('الافتراضي ٥ لما المتغيّر مش موجود', () => {
    delete process.env.AUTH_REGISTRATION_THROTTLE_LIMIT;
    expect(registrationThrottleLimit('development')).toBe(REGISTRATION_THROTTLE_LIMIT_DEFAULT);
  });

  it('**الإنتاج والـstaging مقفولين على الافتراضي** مهما كانت قيمة المتغيّر', () => {
    process.env.AUTH_REGISTRATION_THROTTLE_LIMIT = '100000';
    expect(registrationThrottleLimit('production')).toBe(REGISTRATION_THROTTLE_LIMIT_DEFAULT);
    expect(registrationThrottleLimit('staging')).toBe(REGISTRATION_THROTTLE_LIMIT_DEFAULT);
  });

  it('بره الإنتاج السقف بيترفع — ده اللي بيخلي السويتات الحية تعدّي', () => {
    process.env.AUTH_REGISTRATION_THROTTLE_LIMIT = '1000';
    expect(registrationThrottleLimit('development')).toBe(1000);
    expect(registrationThrottleLimit('test')).toBe(1000);
  });

  it('قيمة أقل من الافتراضي بتتجاهل — المتغيّر للرفع بس مش للتخفيف', () => {
    process.env.AUTH_REGISTRATION_THROTTLE_LIMIT = '1';
    expect(registrationThrottleLimit('development')).toBe(REGISTRATION_THROTTLE_LIMIT_DEFAULT);
  });

  it('قيمة مش رقم بترجع للافتراضي بلا ما تكسر الإقلاع', () => {
    process.env.AUTH_REGISTRATION_THROTTLE_LIMIT = 'كتير';
    expect(registrationThrottleLimit('development')).toBe(REGISTRATION_THROTTLE_LIMIT_DEFAULT);
  });
});
