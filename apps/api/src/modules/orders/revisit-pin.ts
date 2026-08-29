import type { DataSource, EntityManager } from 'typeorm';
import type { Order } from './entities/order.entity';

/**
 * ADR-0051 — حالة تثبيت إعادة الزيارة على الفني الأصلي.
 *
 * الملف ده **دوال خالصة بلا DI عمدًا**: `MatchingModule` مابيستوردش `OrdersModule` عن قصد
 * (تعليق مفصّل في `matching.module.ts` — الاستيراد كان بيقلب ترتيب تسجيل المسارات ويكسر
 * `GET /technician/orders/available`). فالمنطق المشترك بين المطابقة وإدارة الأدمن لازم يعيش
 * في وحدة محايدة زي دي، مش في service محقون.
 */

/** الفني الأصلي "خلاص مبقاش عنده الطلب" — السبب اللي بيظهر للأدمن ويسمحله يحرّر. */
export type RevisitPinExhaustionReason = 'refused' | 'no_response';

export interface RevisitPinState {
  /** الطلب إعادة زيارة مثبّتة على فني ولسه متحرّرتش. */
  pinned: boolean;
  /** الفني الأصلي فعلاً مبقاش عنده الطلب (رفض/لغى/عدّت المهلة) — شرط أي تحرير أو خصم. */
  exhausted: boolean;
  reason: RevisitPinExhaustionReason | null;
  technicianId: string | null;
  /** لحظة انتهاء مهلة رد الفني (null لو الطلب مش مثبّت). */
  deadlineAt: Date | null;
}

const NOT_PINNED: RevisitPinState = {
  pinned: false,
  exhausted: false,
  reason: null,
  technicianId: null,
  deadlineAt: null,
};

/** فحص رخيص بلا استعلام — بيتنادى في المسار الساخن للمطابقة قبل أي شغل إضافي. */
export function isRevisitPinActive(order: Pick<Order, 'revisitPinnedTechnicianId' | 'revisitReleasedAt'>): boolean {
  return order.revisitPinnedTechnicianId !== null && order.revisitReleasedAt === null;
}

/**
 * حالة التثبيت الكاملة. "اتقفل" (`exhausted`) **مشتقّة من مصادر الحقيقة الموجودة** مش من عمود
 * جديد: رفض مسجّل في `order_assignments`، أو إلغاء بعد القبول مسجّل في
 * `technician_order_cancellations`، أو عدّت المهلة بلا رد. كده مفيش حالة موازية ممكن تتعارض مع
 * السجلات الفعلية.
 */
export async function loadRevisitPinState(
  runner: DataSource | EntityManager,
  order: Pick<Order, 'id' | 'revisitPinnedTechnicianId' | 'revisitPinnedAt' | 'revisitReleasedAt'>,
  responseWindowHours: number,
): Promise<RevisitPinState> {
  if (!isRevisitPinActive(order)) return NOT_PINNED;

  const technicianId = order.revisitPinnedTechnicianId!;
  const pinnedAt = order.revisitPinnedAt ?? null;
  const deadlineAt = pinnedAt
    ? new Date(pinnedAt.getTime() + Math.max(0, responseWindowHours) * 60 * 60 * 1000)
    : null;

  const [{ refused }] = await runner.query<Array<{ refused: boolean }>>(
    `SELECT (
       EXISTS (
         SELECT 1 FROM order_assignments
         WHERE order_id = $1 AND technician_id = $2 AND assignment_status = 'rejected'
       )
       OR EXISTS (
         SELECT 1 FROM technician_order_cancellations
         WHERE order_id = $1 AND technician_id = $2
       )
     ) AS refused`,
    [order.id, technicianId],
  );

  if (refused) {
    return { pinned: true, exhausted: true, reason: 'refused', technicianId, deadlineAt };
  }
  if (deadlineAt !== null && deadlineAt.getTime() <= Date.now()) {
    return { pinned: true, exhausted: true, reason: 'no_response', technicianId, deadlineAt };
  }
  return { pinned: true, exhausted: false, reason: null, technicianId, deadlineAt };
}

export const REVISIT_RESPONSE_WINDOW_HOURS_SETTING = 'revisit.original_technician_response_hours';
export const REVISIT_RESPONSE_WINDOW_HOURS_FALLBACK = 48;
