import { BookingMode, Order, OrderStatus } from '../orders/entities/order.entity';
import { isRevisitPinActive } from '../orders/revisit-pin';

/**
 * **مسار توزيع الطلب — مصدر حقيقة واحد** (تدقيق النظام، docs/system-audit §06).
 *
 * `dispatchOrAutoConfirm()` بتختار بين مسارين مختلفين جوهريًا:
 *
 * - **جولات** (`dispatchNextRound`): عرض بيتبعت لدفعة فنيين، والفني **لازم يقبل بنفسه**.
 * - **تأكيد تلقائي** (`autoConfirmScheduledOrder`): الفني بيتعيّن **بلا موافقته**.
 *
 * الفرق ده كان **غير مرئي في واجهة الأدمن**: طلبان بنفس `booking_mode` بالظبط (`individual`)
 * بياخدوا مسارين مختلفين حسب بُعد الموعد — واحد بعد ٣٠ ساعة بيروح للجولات، وواحد بعد ٥ أيام
 * بيتأكّد تلقائيًا. الأدمن كان بيشوف «وضع الحجز: أفراد» للاتنين ومايعرفش ليه واحد استنى قبول
 * والتاني لأ. دي هي «الفئة التالتة» الموثّقة في §06 §4.
 *
 * الدوال هنا **خالصة** (صفر DI، صفر استعلام)، عشان تُستخدم من:
 *  - `MatchingService.dispatchOrAutoConfirm()` — التوجيه الفعلي.
 *  - `MatchingExplainabilityService.explainOrderFunnel()` — عرض السبب للأدمن.
 *
 * كده الشرح اللي الأدمن بيقراه **هو نفس القرار اللي اتنفّذ**، مش إعادة تنفيذ للقاعدة في
 * الواجهة ممكن تنحرف عنها (نفس فلسفة `technicianAvailabilityCondition()`).
 */
export type DispatchRoute = 'rounds' | 'auto_confirm' | 'not_dispatchable';

export type DispatchRouteReason =
  | 'emergency'
  | 'revisit_pinned'
  | 'revisit_scheduled_far'
  | 'near_term'
  | 'scheduled_far'
  | 'same_day_workload'
  | 'existing_requests'
  | 'selected_provider_request'
  | 'not_searching';

export interface DispatchRouteDecision {
  route: DispatchRoute;
  reason: DispatchRouteReason;
  /** عتبة «قريب» بالساعات وقت اتخاذ القرار — عشان الشرح يبقى بالرقم الفعلي مش برقم مكتوب. */
  nearTermHours: number;
}

/**
 * تعريف «طوارئ» الوحيد في محرك التوزيع. عايش هنا مش في `MatchingService` عشان مايبقاش فيه
 * نسختين من نفس السؤال — الشرح والتنفيذ بيقراوا من نفس السطر.
 */
export function isEmergencyBookingMode(order: Pick<Order, 'bookingMode'>): boolean {
  return order.bookingMode === BookingMode.EMERGENCY;
}

/** هل الموعد ده «قريب» بمقياس `matching.near_term_request_hours`؟ ASAP دايمًا قريب. */
export function isNearTerm(scheduledAt: Date | null, thresholdHours: number, now = Date.now()): boolean {
  if (thresholdHours <= 0) return false;
  if (!scheduledAt) return true;
  return scheduledAt.getTime() - now <= thresholdHours * 60 * 60 * 1000;
}

export type DispatchRouteOrder = Pick<
  Order,
  'orderStatus' | 'bookingMode' | 'scheduledAt' | 'revisitPinnedTechnicianId' | 'revisitReleasedAt'
>;

export function resolveDispatchRoute(
  order: DispatchRouteOrder,
  nearTermHours: number,
  now = Date.now(),
): DispatchRouteDecision {
  if (order.orderStatus !== OrderStatus.SEARCHING_TECHNICIAN) {
    return { route: 'not_dispatchable', reason: 'not_searching', nearTermHours };
  }
  if (isEmergencyBookingMode(order)) return { route: 'rounds', reason: 'emergency', nearTermHours };
  // إعادة الضمان القريبة تظل طلبًا يحتاج موافقة. أما الموعد البعيد الذي اختاره محرك التوافر
  // للفني الأصلي فيتأكد تلقائيًا، فلا يصل له request معروف مسبقًا أنه سيتعارض مع جدوله.
  if (isRevisitPinActive(order)) {
    return isNearTerm(order.scheduledAt, nearTermHours, now)
      ? { route: 'rounds', reason: 'revisit_pinned', nearTermHours }
      : { route: 'auto_confirm', reason: 'revisit_scheduled_far', nearTermHours };
  }
  if (isNearTerm(order.scheduledAt, nearTermHours, now)) {
    return { route: 'rounds', reason: 'near_term', nearTermHours };
  }
  return { route: 'auto_confirm', reason: 'scheduled_far', nearTermHours };
}

/** شرح عربي جاهز للعرض — نفس القرار، متحوّل لجملة يقراها الأدمن. */
export function describeDispatchRoute(decision: DispatchRouteDecision): string {
  switch (decision.reason) {
    case 'emergency':
      return 'جولات عروض — طلب طوارئ، الفني لازم يقبل بنفسه';
    case 'revisit_pinned':
      return 'جولات عروض — إعادة زيارة خلال المهلة القريبة، والفني الأصلي لازم يقبلها بنفسه';
    case 'revisit_scheduled_far':
      return `تأكيد تلقائي — إعادة الضمان حُجزت للفني الأصلي في أول موعد متاح أبعد من ${decision.nearTermHours} ساعة`;
    case 'near_term':
      return `جولات عروض — الموعد خلال ${decision.nearTermHours} ساعة، فالفني لازم يقبل بنفسه مش يتفاجأ بشغل اتعيّنله`;
    case 'scheduled_far':
      return `تأكيد تلقائي مشروط — الموعد أبعد من ${decision.nearTermHours} ساعة والفني بلا شغل آخر في أيام الطلب؛ يُعاد الفحص قبل التعيين`;
    case 'same_day_workload':
      return 'طلب يحتاج قبول — الفني عنده شغل آخر في أيام الطلب؛ الاختيار التلقائي يرسل دفعة، واختيار العميل يظل حصريًا';
    case 'existing_requests':
      return 'في انتظار قبول — الطلب دخل جولات العرض ويظل اختياريًا حتى لو تغيّر حمل الفني';
    case 'selected_provider_request':
      return 'اختيار العميل حصري — التحقق من إتاحة الفني وإبلاغ العميل لو احتاج يختار من جديد';
    case 'not_searching':
      return 'مش في مرحلة التوزيع دلوقتي — التوزيع بيشتغل على الطلبات اللي حالتها «بيدوّر على فني» بس';
  }
}

/** تصنيف قدرة المرشّح كما `classifyTechnicianCapacity()` بترجّعه — `null` = مفيش مرشّح أصلاً. */
export type CandidateCapacityTier = 'LIGHT' | 'MEANINGFUL' | 'HEAVY' | 'BLOCKED';

export interface WorkloadGateInput {
  /** عدد العروض **الحيّة** على الطلب (`sent`/`viewed`) — مش كل التاريخ. */
  liveRequestCount: number;
  hasOpenOffer: boolean;
  /** `null` لما مفيش مرشّح مؤهّل أصلاً. */
  candidateTier: CandidateCapacityTier | null;
  /** `matching.auto_confirm_requires_idle_technician` — الافتراضي `false`. */
  requiresIdleTechnician: boolean;
}

/**
 * **بوابة الحمل: امتى الطلب البعيد يتحوّل لطلب يحتاج قبول؟** (docs/08 §156).
 *
 * دالة خالصة زي باقي الملف — عشان القرار الفعلي (`scheduledDispatchDecision`)، وشرح الأدمن،
 * والاختبار كلهم يقروا **نفس السطور** بدل ما الاختبار يختبر نسخة من المنطق.
 *
 * ### القاعدتين اللي اتضبطوا بعد بلاغ المالك
 *
 * **١. `existing_requests` بيقرا العروض الحيّة بس.** كان بيعدّ **كل** صفوف `order_assignments`
 * بلا فلتر حالة، فعرض انتهت مهلته من ساعتين (`timeout`) — ميت ومالوش أي أثر على الحاضر — كان
 * بيخلّي طلب معاده بعد أسبوع يفضل في الجولات للأبد. القصد الأصلي مشروع («عرض مفتوح مايتاخدش
 * من تحت رجل الفني اللي بيفكّر فيه») وهو اللي فضل.
 *
 * **٢. `same_day_workload` بيقرا التعارض الحقيقي، مش وجود شغل.** كان `tier !== 'LIGHT'`،
 * و`MEANINGFUL` معناها بالتعريف «عنده شغل تحت السقف وبلا أي تقاطع» — يعني الشخص **مؤهّل
 * بالكامل**، وهو نفسه اللي عدّى `technicianAvailabilityCondition` وظهر للعميل عشان كده.
 * فالبوابة كانت بتكرّر بوابة الإتاحة وتطلّع إجابة مختلفة عنها.
 *
 * **ملاحظة مقاسة**: `HEAVY`/`BLOCKED` مستبعدين أصلاً من `technicianAvailabilityCondition`،
 * فالمرشّح اللي بيوصل هنا نادرًا ما بيكون واحد منهم. الفرعين متسيبين لأنهم الحد الصح للقاعدة،
 * والإعداد هو اللي بيرجّع السلوك القديم لو القرار التجاري اتغيّر.
 */
export function resolveWorkloadGate(
  input: WorkloadGateInput,
): { route: Extract<DispatchRoute, 'rounds' | 'auto_confirm'>; reason: DispatchRouteReason } | null {
  if (input.liveRequestCount > 0 || input.hasOpenOffer) {
    return { route: 'rounds', reason: 'existing_requests' };
  }
  if (input.candidateTier === null) return null;
  const blocks = input.requiresIdleTechnician
    ? input.candidateTier !== 'LIGHT'
    : input.candidateTier === 'HEAVY' || input.candidateTier === 'BLOCKED';
  return blocks ? { route: 'rounds', reason: 'same_day_workload' } : null;
}
