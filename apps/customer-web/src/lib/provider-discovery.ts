/**
 * **بوابة «إمتى نسأل مين متاح؟» في فلو الحجز** (بلاغ مالك 2026-09-19).
 *
 * قايمة المنفّذين بتجاوب على سؤال واحد: «مين متاح **للحجز ده**؟». والحجز ده مش موجود لسه لو
 * العميل ماختارش ميعاد — فالسؤال نفسه غلط، مش إجابته. الباك-إند بيقرا الميعاد الغايب
 * بـ`COALESCE(scheduled_at, now())`، يعني بيقيس التوافر على **دلوقتي**: فني مؤهّل تمامًا
 * للموعد اللي العميل ناوي عليه بيختفي لمجرد إنه مشغول اللحظة دي، والشاشة بتقول «مفيش فنيين
 * متاحين في منطقتك» قبل ما يتحدد أي ميعاد أصلاً.
 *
 * الترتيب المحفوظ زي ما هو: خدمة ← عنوان ← تفاصيل ← تاريخ ← ساعة (لو مطلوبة) ← منفّذ.
 *
 * الملف ده **دوال نقية بالكامل، صفر اعتماديات** — مفصول عن الصفحة عشان القاعدة دي ليها حالات
 * حدّية حقيقية (طوارئ نفس اليوم، خدمة مابتقبلش جدولة، مدى مرن، دقة الساعة) وتستاهل تتاخد
 * بذاتها في اختبار من غير تشغيل صفحة React كاملة. نفس فلسفة `booking-mode-resolver.ts` في
 * الباك-إند بالحرف.
 */

/** دقة الموعد زي ما الخدمة ضابطاها — `start_time` معناها إن الساعة جزء من الحجز مش تفصيلة. */
export type ProviderSchedulePrecision = 'full_day' | 'start_time';

export interface ProviderScheduleReadyInput {
  /** `services.allows_scheduling` — `false` يعني ASAP حقيقي مفيش فيه ميعاد أصلاً. */
  allowsScheduling: boolean;
  schedulePrecision: ProviderSchedulePrecision | null;
  scheduleDayMode: 'specific' | 'flexible';
  /** `YYYY-MM-DD` أو سلسلة فاضية لو لسه ماتحددش. */
  scheduledDate: string;
  /** نهاية المدى في الوضع المرن — `YYYY-MM-DD` أو فاضي. */
  scheduledDateRangeEnd: string;
  /** `HH:mm` أو فاضي. */
  preciseTime: string;
  /** العميل اختار النهارده ⇒ طوارئ، وغياب الميعاد فيه **مقصود** مش مدخلات ناقصة. */
  isSameDayBooking: boolean;
}

/**
 * هل عندنا معلومات جدولة كفاية عشان نسأل «مين متاح للحجز ده؟».
 *
 * `false` **مش** معناها «مفيش منفّذين» — معناها إن السؤال لسه ماينفعش يتسأل، والواجهة بتعرض
 * حالة محايدة بدل قايمة فاضية مضلّلة.
 */
export function isProviderDiscoveryReady(input: ProviderScheduleReadyInput): boolean {
  // خدمة مابتقبلش جدولة = ASAP حقيقي، مفيش ميعاد أصلاً وبالتالي جاهزة على طول.
  if (!input.allowsScheduling) return true;
  // حجز نفس اليوم = طوارئ؛ `scheduled_at = null` هناك معناها «دلوقتي» عن قصد.
  if (input.isSameDayBooking) return true;
  if (input.scheduleDayMode === 'flexible') {
    // المدى المرن ماينفعش يتقاس بطرف واحد — الطرفين بيحددوا فضاء الأهلية.
    return Boolean(input.scheduledDate) && Boolean(input.scheduledDateRangeEnd);
  }
  if (!input.scheduledDate) return false;
  // `start_time` محتاجة ساعة فوق التاريخ — من غيرها الأهلية بتتقاس على منتصف الليل، وده
  // موعد حقيقي مختلف تمامًا عن اللي العميل هيختاره.
  return input.schedulePrecision !== 'start_time' || Boolean(input.preciseTime);
}

export interface ProviderEligibilityInput extends ProviderScheduleReadyInput {
  /** العنوان بيحدد النطاق، والنطاق بيحدد مين أصلاً في فضاء الأهلية. */
  addressId: string | null;
  pricingModel: string | null;
  /** حقول الشغل — بتحدد المدة والطاقم المطلوب، يعني بتغيّر مين متاح فعلاً. */
  fieldValues: Record<string, unknown> | null;
}

/**
 * **بصمة كل مدخل بيغيّر إجابة «مين متاح؟»** — أي تغيّر فيها بيبطّل القايمة **والاختيار**.
 *
 * من غير البصمة دي الاختيار القديم كان بيفضل ظاهر على سياق جديد: العميل يختار فني، يرجع
 * يغيّر الميعاد أو العنوان، والشاشة تفضل عارضة الفني كأنه متاح — وهو ممكن يكون بقى غير مؤهّل
 * خالص، فالباك-إند يرفضه عند التأكيد. وعد كاذب أسوأ من قايمة فاضية.
 *
 * مبنية بـ`JSON.stringify` عمدًا مش بهوية الكائن: `fieldValues` بيتبني من جديد كل رندر،
 * فالمقارنة بالهوية كانت هتعيد الجلب بلا داعي كل مرة.
 */
export function providerEligibilityKey(input: ProviderEligibilityInput): string {
  return JSON.stringify([
    input.addressId ?? '',
    input.allowsScheduling,
    input.schedulePrecision ?? '',
    input.scheduleDayMode,
    input.scheduledDate,
    input.scheduledDateRangeEnd,
    input.preciseTime,
    input.isSameDayBooking,
    input.pricingModel ?? '',
    input.pricingModel === 'formula' ? (input.fieldValues ?? null) : null,
  ]);
}
