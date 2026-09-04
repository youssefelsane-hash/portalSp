import { BookingMode } from './entities/order.entity';

/**
 * اشتقاق وضع الحجز (ADR-0048، docs/08 §85) — **دوال نقية بالكامل، صفر اعتماديات**.
 *
 * الوضع بقى **ناتج محسوب** مش اختيار من العميل. مفصولة عن `OrdersService` عمدًا لنفس سبب
 * `deferred-dispatch.util.ts` بالحرف: القاعدة دي ليها حالات حدّية كتير (حدود اليوم، الخدمات
 * اللي مابتقبلش نفس اليوم، تعارض التقدير مع إعداد الخدمة) ولازم تتاخد بذاتها في اختبار من غير
 * تجهيز كل اعتماديات `create()` التقيلة.
 */

/** منطقة العمل الوحيدة للمشروع — نفس القيمة الحرفية المستخدمة في كل حسابات "اليوم" في النظام. */
const PLATFORM_TIMEZONE = 'Africa/Cairo';

/**
 * تاريخ اليوم بتوقيت المنصة بصيغة `YYYY-MM-DD`.
 *
 * **مقارنة نصوص تواريخ عمدًا، مش حساب حدود اليوم في JS.** ده مش تفضيل أسلوب — ده تجنّب لبَقّة
 * حقيقية اتلقطت واتوثّقت قبل كده في `orders.service.ts` (`CAIRO_DAY_EXPR`): أول نسخة هناك كانت
 * بتحسب بداية اليوم بـ`toLocaleString` + `setHours(0,0,0,0)`، وده بياخد **تاريخ** القاهرة ويحط
 * عليه منتصف ليل **توقيت السيرفر** (UTC) — يعني 03:00 بتوقيت القاهرة. النتيجة كانت إن أول تلات
 * ساعات من كل يوم مصري بتتحسب غلط. `toLocaleDateString('en-CA')` بيرجّع `YYYY-MM-DD` مباشرة
 * ومقارنته نصيًا مافيهاش أي حساب حدود أصلاً.
 */
export function platformDayOf(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: PLATFORM_TIMEZONE });
}

export interface UrgencyInput {
  /** اليوم اللي العميل اختاره — `null` يعني مفيش تاريخ اتبعت أصلاً (شوف الشرح تحت). */
  scheduledAt: Date | null;
  now?: Date;
}

/**
 * هل الطلب ده **استعجالي** (العميل اختار النهارده)؟
 *
 * **طلب بلا تاريخ = مش استعجالي، وده قرار مقصود اتاخد بعد ما الاختبارات الحية كشفت المشكلة.**
 *
 * المنطق الأول هنا كان "بلا تاريخ = دلوقتي = استعجالي"، وهو صح مفاهيميًا وغلط عمليًا لسببين
 * لقيناهم لما السويت الكاملة اتشغّلت:
 *   1. **فلوس بتتحصّل بلا إخطار.** رسوم الاستعجال مبرَّرة لأن العميل شاف التنبيه الأحمر واختار
 *      يكمّل. طلب جاي من قناة مابتبعتش تاريخ (مركز اتصال، أدمن، تكامل قديم) محدش وراه شاف أي
 *      تنبيه — تحصيل زيادة عليه بيبقى مفاجأة، وده بالظبط اللي التنبيه اتعمل عشان يمنعه.
 *   2. **بوابة `allows_emergency` كانت بترفض طلبات مالهاش علاقة.** خدمة الأدمن قافل عليها نفس
 *      اليوم كانت بتترفض على أي طلب بلا تاريخ، رغم إن محدش طلب نفس اليوم أصلاً.
 *
 * تطبيق العميل بقى بيبعت اليوم **دايمًا** (ADR-0048 §1)، فحجز العميل لنفس اليوم مغطّى بالكامل.
 * البث بقى فوري لكل طلب بلا استثناء بعد ما آلية التأجيل اتشالت (docs/08 §125) — يعني مفيش
 * تأخير، بس كمان مفيش رسوم ولا بوابة.
 *
 * **يوم فات** بيتحسب استعجالي — مش حالة صالحة أصلاً (التحقق بيرفضها قبل كده)، بس لو عدّت لأي
 * سبب فمعالجتها كشغل النهارده أأمن من معالجتها كشغل مجدول بعيد يتأجل بثه.
 */
export function isSameDayUrgent(input: UrgencyInput): boolean {
  if (!input.scheduledAt) return false;
  const today = platformDayOf(input.now ?? new Date());
  return platformDayOf(input.scheduledAt) <= today;
}

/** قدرات الخدمة زي ما الأدمن ضابطها — قيود حقيقية على الناتج، مش تلميحات. */
export interface ServiceBookingCapabilities {
  allowsIndividual: boolean;
  allowsTeam: boolean;
  allowsEmergency: boolean;
}

export interface BookingModeInput {
  urgent: boolean;
  /** ناتج محرك التسعير/الحجز — عدد الفنيين المطلوبين للشغلانة. */
  requiredTechnicians: number | null;
  /** ناتج محرك التسعير/الحجز — عدد المساعدين المطلوبين. */
  requiredAssistants: number | null;
  service: ServiceBookingCapabilities;
}

/**
 * الوضع النهائي (ADR-0048 §1/§3).
 *
 * الاستعجال بيكسب دايمًا: طلب نفس اليوم بيبقى `emergency` حتى لو محتاج فريق كامل — طلب مالك
 * صريح («حتى لو الشخص مختار فريق ومختار الشغل النهارده، بيدخل خانة الطوارئ»). الحجم بيتحدد بس
 * لما الطلب مش مستعجل.
 */
export function resolveBookingMode(input: BookingModeInput): BookingMode {
  if (input.urgent) return BookingMode.EMERGENCY;

  const needsMoreThanOne = (input.requiredTechnicians ?? 1) > 1 || (input.requiredAssistants ?? 0) > 0;

  // إعداد الأدمن هو الحاكم في الاتجاهين (ADR-0048 §3): خدمة شغل-فريق-بحت بتفضل فريق مهما كان
  // العدد، وخدمة الأدمن قال إنها بفرد واحد بتفضل فردي حتى لو التقدير طلب أكتر (التعارض ده
  // يتصلح في إعداد الخدمة، مش بتجاوز قرار الأدمن وقت الحجز).
  if (!input.service.allowsIndividual && input.service.allowsTeam) return BookingMode.TEAM;
  if (needsMoreThanOne && input.service.allowsTeam) return BookingMode.TEAM;
  return BookingMode.INDIVIDUAL;
}

/**
 * هل نقدر نقبل طلب نفس اليوم للخدمة دي؟
 *
 * الأدمن اللي بيقول (`allows_emergency`). رفض الطلب أوضح بكتير من تسجيله عادي: العميل اختار
 * النهارده وهو متوقّع حد يجي النهارده، وخدمة الأدمن قافل عليها نفس اليوم مش هتوفّر ده.
 */
export function canAcceptSameDay(service: ServiceBookingCapabilities): boolean {
  return service.allowsEmergency;
}
