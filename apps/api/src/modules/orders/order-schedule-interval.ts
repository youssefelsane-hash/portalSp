import { HttpStatus } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { TechnicianScheduleSlot } from '../technicians/entities/technician-schedule-slot.entity';
import { Order } from './entities/order.entity';

/**
 * **حساب فترة الموعد والتعارض عليها — دوال خالصة** (تدقيق A-1، شريحة ٢).
 *
 * الشريحة دي طلعت من `OrdersService` قبل شريحة إعادة الجدولة نفسها، لأن مستهلكيها **مش كلهم**
 * في فلو إعادة الجدولة: `create()` بتفحص التعارض، و`resolveFailedVisit()` بتحسب الفترة. لو
 * الدوال دي عاشت جوّه خدمة إعادة الجدولة، كان المسارين دول هيضطروا يعتمدوا عليها بلا سبب —
 * أو (الأسوأ) يعيدوا كتابتها.
 *
 * صفر DI: كل دالة بتاخد اللي محتاجاه كوسيط. يعني قابلة للاختبار من غير بناء أي خدمة.
 */

/**
 * الحالات اللي **مابتحجزش وقت الفني**. الطلب فيها انتهى أو اتلغى، فوجوده على نفس الفترة مش
 * تعارض.
 *
 * مكتوبة كقايمة SQL واحدة عشان الاستعلامين اللي تحت (وكانوا نسختين شبه متطابقتين قبل التوحيد)
 * مايختلفوش أبدًا.
 */
const NON_BLOCKING_ORDER_STATUSES_SQL = `('cancelled_by_customer', 'cancelled_by_technician', 'cancelled_by_system', 'expired', 'completed', 'refunded')`;

/** بداية السلوت كـ`Date`. `slot_date` + `start_time` مخزّنين UTC (القاموس §1.3). */
export function slotStart(slot: TechnicianScheduleSlot): Date {
  return new Date(`${slot.slotDate}T${slot.startTime}Z`);
}

export function slotEnd(slot: TechnicianScheduleSlot): Date {
  return new Date(`${slot.slotDate}T${slot.endTime}Z`);
}

/**
 * فترة الموعد الجديدة بعد إعادة الجدولة: نهاية صريحة لو اتبعتت، وإلا نفس مدة الموعد القديم
 * محسوبة من البداية الجديدة.
 */
export function resolveRescheduledInterval(
  order: Order,
  newScheduledAt: Date,
  explicitEndIso?: string,
): { scheduledEndAt: Date | null; durationMinutes: number | null } {
  if (explicitEndIso != null && order.scheduledEndAt == null) {
    throw new ApiException(
      ErrorCode.VAL_001,
      'تحديد نهاية جديدة متاح فقط للطلبات التي لها بداية ونهاية أصلًا',
      HttpStatus.BAD_REQUEST,
    );
  }

  let scheduledEndAt: Date | null = null;
  if (explicitEndIso != null) {
    scheduledEndAt = new Date(explicitEndIso);
    if (Number.isNaN(scheduledEndAt.getTime())) {
      throw new ApiException(ErrorCode.VAL_001, 'الموعد النهائي الجديد مش تاريخ صالح', HttpStatus.BAD_REQUEST);
    }
  } else if (order.scheduledAt && order.scheduledEndAt) {
    const previousDurationMs = order.scheduledEndAt.getTime() - order.scheduledAt.getTime();
    scheduledEndAt = new Date(newScheduledAt.getTime() + previousDurationMs);
  }

  const durationMinutes = scheduledEndAt
    ? (scheduledEndAt.getTime() - newScheduledAt.getTime()) / 60_000
    : (order.durationMinutes ?? (order.durationHours == null ? null : Number(order.durationHours) * 60));
  if (durationMinutes != null && (!Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 525_600)) {
    throw new ApiException(
      ErrorCode.VAL_001,
      'مدة الموعد الجديد لازم تكون عدد دقائق صحيحًا وموجبًا وفي حدود سنة',
      HttpStatus.BAD_REQUEST,
    );
  }
  return { scheduledEndAt, durationMinutes };
}

/** أي حاجة تقدر تنفّذ استعلام — `DataSource` برّه transaction، و`EntityManager` جوّاها. */
type QueryRunnerLike = Pick<DataSource | EntityManager, 'query'>;

export interface ScheduleOverlapCheck {
  technicianId: string;
  startsAt: Date;
  endsAt: Date;
  /** الطلب اللي بنعيد جدولته — مايتحسبش متعارضًا مع نفسه. */
  excludeOrderId?: string | null;
}

/**
 * **مصدر واحد لسؤال: «الفني ده عنده شغل تاني على الفترة دي؟»**
 *
 * قبل التوحيد كان فيه **نسختين** من نفس الاستعلام في نفس الملف، بفرقين صامتين:
 *
 * | | فحص الدقة (`create`) | فحص إعادة الجدولة |
 * |---|---|---|
 * | نهاية الطلب المتعارض | `scheduled_at + duration` بس | `COALESCE(scheduled_end_at, scheduled_at + duration)` |
 * | طلب له `scheduled_end_at` بلا `duration` | **بيتجاهَل تمامًا** (شرط `duration IS NOT NULL`) | بيتحسب |
 *
 * يعني حجز بنهاية صريحة بلا مدة كان **بيعدّي بلا تعارض** في مسار الإنشاء ويتمسك في مسار إعادة
 * الجدولة — نفس البيانات، إجابتين. النسخة الموحّدة بتاخد التعريف الأصح (`COALESCE`)، فالفحص بقى
 * أدق مش أوسع بلا داعي.
 *
 * **علاقتها بـ`technicianAvailabilityCondition()`**: دي بتجاوب على «الفني مؤهّل ومتاح للتوزيع؟»
 * (سعة يومية، سلوتات، حالات)، والدالة دي بتجاوب على «الفترة دي بالتحديد محجوزة؟» لفني **معروف
 * سلفًا**. سؤالان مختلفان، مش تكرار.
 */
export async function assertNoScheduleOverlap(
  runner: QueryRunnerLike,
  check: ScheduleOverlapCheck,
  buildMessage: (conflictingOrderNumber: string) => string,
): Promise<void> {
  const [conflict] = await runner.query<{ order_number: string }[]>(
    `SELECT order_number FROM orders
     WHERE technician_id = $1
       AND ($4::uuid IS NULL OR id <> $4::uuid)
       AND order_status NOT IN ${NON_BLOCKING_ORDER_STATUSES_SQL}
       AND scheduled_at IS NOT NULL
       AND scheduled_at < $3
       AND COALESCE(
             scheduled_end_at,
             scheduled_at + (COALESCE(duration_minutes, duration_hours * 60) || ' minutes')::interval
           ) > $2
     LIMIT 1`,
    [check.technicianId, check.startsAt, check.endsAt, check.excludeOrderId ?? null],
  );
  if (conflict) {
    throw new ApiException(ErrorCode.VAL_001, buildMessage(conflict.order_number), HttpStatus.CONFLICT);
  }
}
