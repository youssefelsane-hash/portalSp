import { BookingMode, Order } from '../orders/entities/order.entity';

/**
 * **أوزان المطابقة الديناميكية** (ADR-0062) — المصدر الوحيد لسؤال «قد إيه القرب مهم للطلب ده؟».
 *
 * قبل كده كانت المسافة كاسر تعادل بس (`ORDER BY rank_score DESC, distance_km ASC`)، يعني أي فرق
 * في `rank_score` مهما كان صغير بيتغلّب على أي فرق في المسافة مهما كان كبير. ده صح كقاعدة عامة،
 * وغلط تمامًا في التلات سياقات اللي المالك سمّاها بالاسم: الطوارئ (القيمة كلها في وقت الوصول)،
 * الشغل خلال 48 ساعة (مفيش مساحة لإعادة توزيع)، والشغل الرخيص (تكلفة الانتقال بتاكل الهامش).
 *
 * الوزن بيتحسب هنا في TypeScript وبيتبعت للاستعلام كرقم واحد — كل مدخلاته معروفة في الكود، وحقنه
 * كـCASE في SQL كان هيبقى منطق مكرر في استعلامين (المطابقة والتفسير).
 */

/** كل الأوزان صفر افتراضيًا = السلوك القديم بالحرف (المسافة كاسر تعادل بس). */
export const DISTANCE_WEIGHT_FALLBACK = 0;
export const LOW_VALUE_ORDER_CENTS_FALLBACK = 15_000;
export const NEAR_TERM_REQUEST_HOURS_FALLBACK = 48;

/** أي حاجة عندها `getNumber` — نفس فلسفة `resolveDailyCapacityMinutes` (بلا اعتماد على SettingsService). */
interface NumberSettingReader {
  getNumber(key: string, fallback: number): Promise<number>;
}

/** السياق اللي حدّد الوزن فعلاً — بيتعرض للأدمن في تفسير المطابقة، مش بيأثر على الحساب. */
export type DistanceWeightContext = 'base' | 'emergency' | 'near_term' | 'low_value';

export interface ResolvedDistanceWeight {
  weight: number;
  context: DistanceWeightContext;
}

export const DISTANCE_WEIGHT_CONTEXT_LABELS_AR: Record<DistanceWeightContext, string> = {
  base: 'الوزن الأساسي',
  emergency: 'طوارئ — الأولوية للأقرب',
  near_term: 'موعد قريب (خلال نافذة الشغل العاجل) — الأولوية للأقرب',
  low_value: 'شغلانة سعرها قليل — الأولوية للأقرب',
};

/**
 * الوزن الفعّال للمسافة للطلب ده.
 *
 * **لما أكتر من سياق ينطبق، الأعلى بياخد — مش المجموع.** طلب طوارئ رخيص خلال ساعة بينطبق عليه
 * تلاتة؛ الجمع كان هيدّي وزن 3× مالوش أي معنى مقصود، وكان هيخلّي أثر تغيير إعداد واحد غير متوقّع
 * للأدمن. «الأعلى بياخد» بيخلي كل رقم في الشاشة يجاوب سؤال مباشر: في السياق ده، إيه أقصى شدّة
 * للقرب؟
 */
export async function resolveDistanceWeight(
  settings: NumberSettingReader,
  order: Pick<Order, 'bookingMode' | 'scheduledAt' | 'totalAmountCents'>,
  now: Date = new Date(),
): Promise<ResolvedDistanceWeight> {
  const base = await settings.getNumber('matching.distance_weight', DISTANCE_WEIGHT_FALLBACK);
  let resolved: ResolvedDistanceWeight = { weight: base, context: 'base' };

  const consider = async (key: string, context: DistanceWeightContext): Promise<void> => {
    const candidate = await settings.getNumber(key, DISTANCE_WEIGHT_FALLBACK);
    if (candidate > resolved.weight) resolved = { weight: candidate, context };
  };

  if (order.bookingMode === BookingMode.EMERGENCY) {
    await consider('matching.distance_weight_emergency', 'emergency');
  }

  // طلب بلا موعد (ASAP) هو بالتعريف «دلوقتي» — أقرب ما يكون لنافذة الشغل العاجل، مش خارجها.
  const nearTermHours = await settings.getNumber('matching.near_term_request_hours', NEAR_TERM_REQUEST_HOURS_FALLBACK);
  if (nearTermHours > 0) {
    const scheduledAt = order.scheduledAt ? new Date(order.scheduledAt) : null;
    const withinWindow =
      scheduledAt === null || scheduledAt.getTime() - now.getTime() <= nearTermHours * 3_600_000;
    if (withinWindow) await consider('matching.distance_weight_near_term', 'near_term');
  }

  const lowValueCents = await settings.getNumber('matching.low_value_order_cents', LOW_VALUE_ORDER_CENTS_FALLBACK);
  if (lowValueCents > 0 && (order.totalAmountCents ?? 0) > 0 && (order.totalAmountCents ?? 0) <= lowValueCents) {
    await consider('matching.distance_weight_low_value', 'low_value');
  }

  // وزن سالب مالوش معنى (هيكافئ البُعد) — الصفر بيرجّع «المسافة كاسر تعادل بس».
  return { weight: Math.max(0, resolved.weight), context: resolved.context };
}
