// **إجبار التحقق البيومتري في الـPasskey** (ADR-0111 §4).
//
// البلاغ: «الباسكي عند الأدمن اللي صلاحياته عالية لازم يحط البصمة… واتأكد إنه شغال على أجهزة
// ضعيفة وقوية من غير مشاكل».
//
// الاختبار ده بيقفل **تفاوت** حقيقي: الخيارات كانت بتقول للعميل `userVerification: 'preferred'`
// (التحقق اختياري) بينما السيرفر بيفرض `requireUserVerification: true`. على أي جهاز بياخد
// 'preferred' بمعنى «اتخطاه»، السيريمونى بتخلص عند العميل وبعدين السيرفر يرفضها برسالة عامة
// ومفيش مخرج — وده «مش شغال على الأجهزة الضعيفة» بعينه.
import { readFileSync } from 'fs';
import { join } from 'path';

describe('خيارات الـPasskey بتطلب تحقق المستخدم (ADR-0111)', () => {
  const source = readFileSync(join(__dirname, 'webauthn.service.ts'), 'utf8');

  it('مفيش أي `userVerification: preferred` فاضلة — لا في التسجيل ولا في الدخول', () => {
    expect(source).not.toContain("userVerification: 'preferred'");
  });

  it('التسجيل والدخول الاتنين بيطلبوا التحقق صراحةً', () => {
    const occurrences = source.match(/userVerification: 'required'/g) ?? [];
    expect(occurrences).toHaveLength(2);
  });

  it('`requireUserVerification: true` صريحة في نداءات التحقق — مش اعتمادًا على افتراضي المكتبة', () => {
    // الافتراضي في @simplewebauthn/server v13 هو `true`، بس ترقية مكتبة تقدر تغيّره وساعتها
    // Passkey بلا بصمة يعدّي **في صمت** — أسوأ نوع انحدار أمني. التمرير الصريح بيمنع ده.
    const explicit = source.match(/requireUserVerification: true,/g) ?? [];
    expect(explicit).toHaveLength(2);
  });

  it('**الأجهزة الضعيفة مش مقفولة**: مفيش تقييد على نوع المصادق', () => {
    // `residentKey: 'required'` + مفيش `authenticatorAttachment` = المتصفح بيعرض كل الخيارات:
    // بصمة محلية، أو **QR بيتقرا من الموبايل** (hybrid) والبصمة تحصل على الموبايل، أو مفتاح
    // أمان بـPIN. فجهاز بلا بصمة لسه عنده مسار كامل.
    expect(source).toContain("residentKey: 'required'");
    // **بالكود مش بنص التعليق**: كلمة `authenticatorAttachment` مذكورة في التعليق اللي بيشرح
    // ليه إحنا **مش** بنقيّده، فالبحث عن الكلمة لوحدها كان بيفشل على تعليق سليم.
    expect(source).not.toMatch(/authenticatorAttachment\s*:/);
  });
});
