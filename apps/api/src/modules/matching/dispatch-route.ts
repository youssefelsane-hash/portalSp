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
  | 'near_term'
  | 'scheduled_far'
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
  // ADR-0051 — إعادة زيارة مثبّتة مبتعدّيش على التأكيد التلقائي أبدًا: التثبيت الصح **عرض
  // حصري** الفني يقبله بنفسه، مش تعيين قسري.
  if (isRevisitPinActive(order)) return { route: 'rounds', reason: 'revisit_pinned', nearTermHours };
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
      return 'جولات عروض — إعادة زيارة مثبّتة على الفني الأصلي، بتتعرض عليه ومابتتعيّنش قسرًا';
    case 'near_term':
      return `جولات عروض — الموعد خلال ${decision.nearTermHours} ساعة، فالفني لازم يقبل بنفسه مش يتفاجأ بشغل اتعيّنله`;
    case 'scheduled_far':
      return `تأكيد تلقائي — الموعد أبعد من ${decision.nearTermHours} ساعة، فأعلى مرشّح بيتعيّن مباشرة`;
    case 'not_searching':
      return 'مش في مرحلة التوزيع دلوقتي — التوزيع بيشتغل على الطلبات اللي حالتها «بيدوّر على فني» بس';
  }
}
