import { HttpStatus } from '@nestjs/common';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';

/**
 * **سياسة تحقّق رقم العميل عند أول طلب** (ADR-0112).
 *
 * الملف ده **مصدر الحقيقة الوحيد** للسؤال «هل الحساب ده محتاج يتحقّق من رقمه؟». بيتنادى من
 * مكانين بيعيشوا في موديولين مختلفين:
 *
 *   ١) `OrderCreationService` — البوابة اللي بترفض إنشاء الطلب.
 *   ٢) `PhoneVerificationService` (موديول auth) — إصدار الكود وتأكيده.
 *
 * **ليه ملف بلا DI**: موديول `orders` مابيستوردش `auth` (و`auth` قاعد تحت في جراف الموديولات
 * فاستيراده كان بيخلق دايرة محتاجة `forwardRef` — والكودبيس بيتجنّبه صراحةً في تلات مواضع
 * موثّقة). نسخ الشرط في المكانين كان بيخلي الواجهة تسأل في حالة والبوابة ترفض في حالة تانية أول
 * ما حد يعدّل واحد منهم. دوال حرة بلا حالة = مصدر واحد وصفر تشابك. نفس نمط `pin-setup.ts`.
 */

/** مفتاح الإعداد. مكتوب مرة واحدة هنا — المقارنة بنص حرفي في كل مستهلك هي إزاي مفتاح بيموت بصمت. */
export const REQUIRE_PHONE_VERIFICATION_SETTING = 'orders.require_phone_verification_on_first_order';

/**
 * هل الحساب محتاج يتحقّق من رقمه قبل ما يطلب؟
 *
 * **مفيش حالة جديدة** (ADR-0112 §2): `phone_verified_at` بيفرّق أصلاً بين الحسابات اللي سجّلت
 * بالـOTP (متحطوطة، فمابتتسألش — صفر إزعاج للمستخدمين الحاليين) واللي سجّلت بالرمز (`NULL`).
 * وأول تحقّق ناجح بيحطّها، فالسؤال بيحصل **مرة واحدة في عمر الحساب** بلا أي عدّاد.
 */
export function needsPhoneVerification(
  phoneVerifiedAt: Date | null | undefined,
  settingEnabled: boolean,
): boolean {
  return settingEnabled && !phoneVerifiedAt;
}

/**
 * الرفض الموحّد. `reason` ثابت آلي (ADR-0101) عشان التطبيق يفتح شاشة التحقّق **على نفس بيانات
 * الحجز** اللي المستخدم كتبها بدل ما يفقدها أو يقرا نص عربي.
 */
export function phoneVerificationRequiredError(): ApiException {
  return new ApiException(
    ErrorCode.AUTH_009,
    'قبل أول طلب لازم نتأكد من رقم موبايلك. هنبعتلك كود على الرقم المسجّل، وتقدر تغيّره لو غلط.',
    HttpStatus.FORBIDDEN,
    'phone_verification_required',
  );
}
