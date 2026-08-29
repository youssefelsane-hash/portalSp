import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ESCALATABLE_STATUSES } from '../orders/crew-shortage-escalation.service';
import { computeCrewComposition } from '../orders/order-team.service';
import {
  REVISIT_RESPONSE_WINDOW_HOURS_FALLBACK,
  REVISIT_RESPONSE_WINDOW_HOURS_SETTING,
  type RevisitPinExhaustionReason,
} from '../orders/revisit-pin';
import { SettingsService } from '../settings/settings.service';

const EXCEPTION_LIST_LIMIT = 50;

export interface ExceptionCenterFilters {
  categoryId?: string | null;
  zoneId?: string | null;
}

export interface CrewShortageExceptionItem {
  orderId: string;
  orderNumber: string;
  scheduledAt: string;
  escalatedAt: string;
  missingTechnicians: number;
  missingAssistants: number;
  isOverdue: boolean;
}

export interface StaleDispatchExceptionItem {
  assignmentId: string;
  orderId: string;
  /**
   * رقم الطلب المقروء (docs/08 §77-A3، بلاغ مالك). الصف كان بيعرض لينك عام «عرض الطلب» + اسم
   * الفني + الميعاد وبس — موظف العمليات كان مضطر يفتح كل صف عشان يعرف هو بيبص على إيه.
   * الرقم ده هو الحاجة الوحيدة اللي بيتكلم بيها مع العميل والفني، فغيابه هنا بيبطّل القايمة.
   */
  orderNumber: string;
  technicianId: string;
  technicianCode: string;
  fullName: string;
  sentAt: string;
  expiresAt: string;
}

// docs/08 §56 بند 4 — "شغلانة اتقبلت، يومها عدّى، ولسه ما بدأتش". النوع ده كان **فجوة موثّقة
// صراحة** في README الموديول ("طلبات متأخرة ... محتاجة عتبة زمنية واقعية، قرار صريح من المالك
// قبل الإضافة، مش اختراع عتبة تعسفية"). المالك حدد التعريف بنفسه دلوقتي وهو مش عتبة مخترعة أصلاً:
// حالة `accepted` بالظبط (الفني ما تحرّكش) + يوم الجدولة عدّى. نفس التعريف بالحرف اللي
// `OrdersService.findOverdueForTechnician()` بيستخدمه للفني — الجانبين بيشوفوا نفس الحقيقة.
export interface OverdueOrderExceptionItem {
  orderId: string;
  orderNumber: string;
  scheduledAt: string;
  technicianId: string | null;
  technicianCode: string | null;
  fullName: string | null;
  daysLate: number;
}

// ADR-0051 (docs/08 §96) — إعادة زيارة مثبّتة على الفني الأصلي والفني **خلاص مبقاش عنده الطلب**
// (رفض/لغى بعد القبول/عدّت مهلة الرد). البند ده هو "الـrequest" اللي المالك طلبه بالحرف: بيعرض
// رقم الطلب الأصلي وبيانات تواصل الفني، والأدمن هو اللي بيحرّر (POST /admin/orders/:id/release-revisit).
export interface StalledRevisitExceptionItem {
  orderId: string;
  orderNumber: string;
  /** الطلب الأصلي اللي إعادة الزيارة دي بتخصه — نقطة التتبّع الوحيدة للأدمن. */
  originalOrderId: string | null;
  originalOrderNumber: string | null;
  technicianId: string;
  technicianCode: string;
  fullName: string;
  phone: string | null;
  pinnedAt: string;
  deadlineAt: string;
  reason: RevisitPinExhaustionReason;
  /** نصيب الفني الفعلي من الطلب الأصلي — ده بالظبط اللي هيتخصم منه لو الأدمن حرّر. */
  chargebackCents: number;
}

export interface AdminExceptionCenterResult {
  crewShortage: { items: CrewShortageExceptionItem[]; total: number };
  staleDispatch: { items: StaleDispatchExceptionItem[]; total: number };
  overdueOrders: { items: OverdueOrderExceptionItem[]; total: number };
  stalledRevisits: { items: StalledRevisitExceptionItem[]; total: number };
}

interface RawOverdueOrderRow {
  id: string;
  order_number: string;
  scheduled_at: string;
  technician_id: string | null;
  technician_code: string | null;
  full_name: string | null;
  total_count: string;
}

interface RawCrewShortageRow {
  id: string;
  order_number: string;
  scheduled_at: string;
  crew_shortage_escalated_at: string;
  required_technicians: number | null;
  required_assistants: number | null;
  technicians: string;
  assistants: string;
  total_count: string;
}

interface RawStalledRevisitRow {
  id: string;
  order_number: string;
  original_order_id: string | null;
  original_order_number: string | null;
  technician_id: string;
  technician_code: string;
  full_name: string;
  phone: string | null;
  revisit_pinned_at: string;
  deadline_at: string;
  reason: RevisitPinExhaustionReason;
  chargeback_cents: string | null;
  total_count: string;
}

interface RawStaleDispatchRow {
  id: string;
  order_number: string;
  order_id: string;
  technician_id: string;
  technician_code: string;
  full_name: string;
  sent_at: string;
  expires_at: string;
  total_count: string;
}

/**
 * مركز الاستثناءات/التنبيهات (docs/08 §36.9) — "فوق تصعيد §35.4 + تنبيهات جديدة". قايمة
 * "محتاج تصرّف دلوقتي" مش جدول قابل للتصفح — نفس فلسفة كارت "يحتاج انتباه" في `apps/admin/src/app
 * /page.tsx` (الأدمن العام)، بس مُركّزة على نطاق العمليات/المطابقة. صفر نوع استثناء مخترع بعتبة
 * وقت تعسفية — نوعين بس دلوقتي، الاتنين مبنيين على حقول/شروط حقيقية موجودة بالفعل:
 *
 *  1. **نقص طاقم مصعّد ولسه مفتوح** — إعادة استخدام حرفي لـ`crew_shortage_escalated_at`/
 *     `ESCALATABLE_STATUSES` (§35.4/§35.5، `CrewShortageEscalationService`) و`computeCrewComposition()`
 *     (§35، `order-team.service.ts`) — نفس دالة حساب النقص المستخدمة في تنفيذ العملية الحقيقية،
 *     صفر نسخة موازية. Bulk aggregate بـLEFT JOIN + `COUNT(*) FILTER` بدل نداء منفصل لكل طلب.
 *  2. **توزيع متأخر (stale dispatch)** — نفس شرط `stale_sent_count`/`is_stale` بالحرف من §36.7
 *     (`order_assignments.assignment_status='sent' AND expires_at < now()`), بس هنا **بلا نافذة
 *     hours محدودة** عمدًا (مختلف عن §36.7's rolling observability window) — "لسه sent ومعادها
 *     فات" حالة سيئة بغض النظر عن إمتى اتبعتت، مش نشاط حديث بس.
 *
 * القايمتين محدودتين بـ`EXCEPTION_LIST_LIMIT` (50) — الشاشة دي "لمحة تحتاج تصرّف فوري"، مش أداة
 * تصفح كاملة (لو العدد الحقيقي أكبر، `total` بيعكس الرقم الحقيقي كامل، والتفصيل الكامل موجود في
 * `/orders` المفلترة أو §36.7's dispatch-delivery feed).
 */
@Injectable()
export class AdminExceptionCenterService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
  ) {}

  async getExceptions(filters: ExceptionCenterFilters): Promise<AdminExceptionCenterResult> {
    const categoryId = filters.categoryId ?? null;
    const zoneId = filters.zoneId ?? null;

    const crewShortageRows = await this.dataSource.query<RawCrewShortageRow[]>(
      `
      WITH crew AS (
        SELECT o.id, o.order_number, o.scheduled_at, o.crew_shortage_escalated_at,
               o.required_technicians, o.required_assistants,
               COUNT(otm.*) FILTER (WHERE otm.member_type = 'team_member') AS technicians,
               COUNT(otm.*) FILTER (WHERE otm.member_type = 'assistant') AS assistants
        FROM orders o
        LEFT JOIN order_team_members otm ON otm.order_id = o.id
        JOIN services s ON s.id = o.service_id
        WHERE o.deleted_at IS NULL
          AND o.crew_shortage_escalated_at IS NOT NULL
          AND o.order_status = ANY($1::order_status[])
          AND ($2::uuid IS NULL OR s.category_id = $2)
          AND ($3::uuid IS NULL OR o.service_zone_id = $3)
        GROUP BY o.id
      )
      -- شرط "لسه ناقص" هنا لازم يطابق computeCrewComposition() بالحرف (order-team.service.ts) —
      -- +1 لتقنيي المُعيَّنين تمثيلًا لقائد الطلب نفسه، GREATEST(0, ...) لمنع سالب. مُعاد فحصه
      -- تاني بـTS تحت بنفس الدالة الحقيقية — الشرط هنا للفلترة/العدّ الصحيح بس، مش مصدر الحقيقة.
      SELECT *, COUNT(*) OVER() AS total_count
      FROM crew
      WHERE GREATEST(0, COALESCE(required_technicians, 1) - (technicians + 1)) > 0
         OR GREATEST(0, COALESCE(required_assistants, 0) - assistants) > 0
      ORDER BY scheduled_at ASC
      LIMIT $4
      `,
      [ESCALATABLE_STATUSES, categoryId, zoneId, EXCEPTION_LIST_LIMIT],
    );

    const now = Date.now();
    const crewShortageItems: CrewShortageExceptionItem[] = crewShortageRows.map((r) => {
      const composition = computeCrewComposition(r.required_technicians, r.required_assistants, {
        technicians: Number(r.technicians),
        assistants: Number(r.assistants),
      });
      return {
        orderId: r.id,
        orderNumber: r.order_number,
        scheduledAt: r.scheduled_at,
        escalatedAt: r.crew_shortage_escalated_at,
        missingTechnicians: composition.missingTechnicians,
        missingAssistants: composition.missingAssistants,
        isOverdue: new Date(r.scheduled_at).getTime() < now,
      };
    });
    const staleDispatchRows = await this.dataSource.query<RawStaleDispatchRow[]>(
      `
      SELECT oa.id, oa.order_id, o.order_number, oa.technician_id, tp.technician_code, u.full_name,
             oa.sent_at, oa.expires_at, COUNT(*) OVER() AS total_count
      FROM order_assignments oa
      JOIN orders o ON o.id = oa.order_id
      JOIN services s ON s.id = o.service_id
      JOIN technician_profiles tp ON tp.id = oa.technician_id
      JOIN users u ON u.id = tp.user_id
      -- 'viewed' = وصل واتعرض بس ما اترد عليهوش (docs/08 §72) — استثناء زيّه بالظبط.
      WHERE oa.assignment_status IN ('sent', 'viewed') AND oa.expires_at < now()
        -- إعادة زيارة مثبّتة عمرها ما تكون "توزيع متأخر": العرض مقصود إنه يفضل مفتوح لحد
        -- ما مهلة الفني الأصلي تعدّي (ADR-0051)، وليها بندها الخاص تحت.
        AND NOT (o.revisit_pinned_technician_id IS NOT NULL AND o.revisit_released_at IS NULL)
        AND ($1::uuid IS NULL OR s.category_id = $1)
        AND ($2::uuid IS NULL OR o.service_zone_id = $2)
      ORDER BY oa.expires_at ASC
      LIMIT $3
      `,
      [categoryId, zoneId, EXCEPTION_LIST_LIMIT],
    );

    const staleDispatchItems: StaleDispatchExceptionItem[] = staleDispatchRows.map((r) => ({
      assignmentId: r.id,
      orderId: r.order_id,
      orderNumber: r.order_number,
      technicianId: r.technician_id,
      technicianCode: r.technician_code,
      fullName: r.full_name,
      sentAt: r.sent_at,
      expiresAt: r.expires_at,
    }));

    // نفس شرط findOverdueForTechnician() بالحرف: accepted + يوم الجدولة عدّى (بتوقيت مصر —
    // الجدولة باليوم مش بالساعة، ADR-0018 §2، فمقارنة بـnow() الخام كانت هتعتبر شغل النهاردة متأخر).
    const overdueRows = await this.dataSource.query<RawOverdueOrderRow[]>(
      `
      SELECT o.id, o.order_number, o.scheduled_at, o.technician_id, tp.technician_code, u.full_name,
             COUNT(*) OVER() AS total_count
      FROM orders o
      JOIN services s ON s.id = o.service_id
      LEFT JOIN technician_profiles tp ON tp.id = o.technician_id
      LEFT JOIN users u ON u.id = tp.user_id
      WHERE o.deleted_at IS NULL
        AND o.order_status = 'accepted'
        AND o.scheduled_at IS NOT NULL
        AND (o.scheduled_at AT TIME ZONE 'Africa/Cairo')::date < (now() AT TIME ZONE 'Africa/Cairo')::date
        AND ($1::uuid IS NULL OR s.category_id = $1)
        AND ($2::uuid IS NULL OR o.service_zone_id = $2)
      ORDER BY o.scheduled_at ASC
      LIMIT $3
      `,
      [categoryId, zoneId, EXCEPTION_LIST_LIMIT],
    );

    const overdueItems: OverdueOrderExceptionItem[] = overdueRows.map((r) => ({
      orderId: r.id,
      orderNumber: r.order_number,
      scheduledAt: r.scheduled_at,
      technicianId: r.technician_id,
      technicianCode: r.technician_code,
      fullName: r.full_name,
      daysLate: Math.max(1, Math.floor((now - new Date(r.scheduled_at).getTime()) / (24 * 60 * 60 * 1000))),
    }));

    // ADR-0051 — "اتقفل" مشتقّة من مصادر الحقيقة الموجودة (رفض مسجّل في order_assignments، أو
    // إلغاء بعد القبول في technician_order_cancellations، أو عدّت المهلة) — مفيش عمود حالة موازي
    // ممكن يتعارض مع السجلات الفعلية. نفس منطق loadRevisitPinState() بالحرف، بس bulk.
    const revisitWindowHours = await this.settingsService.getNumber(
      REVISIT_RESPONSE_WINDOW_HOURS_SETTING,
      REVISIT_RESPONSE_WINDOW_HOURS_FALLBACK,
    );
    const stalledRevisitRows = await this.dataSource.query<RawStalledRevisitRow[]>(
      `
      SELECT o.id, o.order_number,
             parent.id AS original_order_id, parent.order_number AS original_order_number,
             o.revisit_pinned_technician_id AS technician_id, tp.technician_code, u.full_name, u.phone_number AS phone,
             o.revisit_pinned_at,
             (o.revisit_pinned_at + make_interval(hours => $3::int)) AS deadline_at,
             CASE WHEN refusal.refused THEN 'refused' ELSE 'no_response' END AS reason,
             -- نصيبه الفعلي من الطلب الأصلي — order_earning_shares هو مصدر الحقيقة (نفس مصدر
             -- كشف المستحقات)، وbackfill لـtechnician_earning_cents للطلبات الفردية القديمة
             -- اللي اتقفلت قبل نظام الحصص.
             COALESCE(
               (SELECT oes.share_cents FROM order_earning_shares oes
                 WHERE oes.order_id = parent.id AND oes.technician_id = o.revisit_pinned_technician_id
                   AND oes.deleted_at IS NULL),
               parent.technician_earning_cents,
               0
             ) AS chargeback_cents,
             COUNT(*) OVER() AS total_count
      FROM orders o
      JOIN services s ON s.id = o.service_id
      JOIN technician_profiles tp ON tp.id = o.revisit_pinned_technician_id
      JOIN users u ON u.id = tp.user_id
      LEFT JOIN orders parent ON parent.id = o.parent_order_id
      CROSS JOIN LATERAL (
        SELECT (
          EXISTS (SELECT 1 FROM order_assignments oa
                   WHERE oa.order_id = o.id AND oa.technician_id = o.revisit_pinned_technician_id
                     AND oa.assignment_status = 'rejected')
          OR EXISTS (SELECT 1 FROM technician_order_cancellations toc
                      WHERE toc.order_id = o.id AND toc.technician_id = o.revisit_pinned_technician_id)
        ) AS refused
      ) refusal
      WHERE o.deleted_at IS NULL
        AND o.revisit_pinned_technician_id IS NOT NULL
        AND o.revisit_released_at IS NULL
        AND o.order_status = 'searching_technician'
        AND (refusal.refused OR o.revisit_pinned_at + make_interval(hours => $3::int) <= now())
        AND ($1::uuid IS NULL OR s.category_id = $1)
        AND ($2::uuid IS NULL OR o.service_zone_id = $2)
      ORDER BY o.revisit_pinned_at ASC
      LIMIT $4
      `,
      [categoryId, zoneId, revisitWindowHours, EXCEPTION_LIST_LIMIT],
    );

    const stalledRevisitItems: StalledRevisitExceptionItem[] = stalledRevisitRows.map((r) => ({
      orderId: r.id,
      orderNumber: r.order_number,
      originalOrderId: r.original_order_id,
      originalOrderNumber: r.original_order_number,
      technicianId: r.technician_id,
      technicianCode: r.technician_code,
      fullName: r.full_name,
      phone: r.phone,
      pinnedAt: r.revisit_pinned_at,
      deadlineAt: r.deadline_at,
      reason: r.reason,
      chargebackCents: Number(r.chargeback_cents ?? 0),
    }));

    return {
      stalledRevisits: {
        items: stalledRevisitItems,
        total: stalledRevisitRows.length > 0 ? Number(stalledRevisitRows[0].total_count) : 0,
      },
      overdueOrders: {
        items: overdueItems,
        total: overdueRows.length > 0 ? Number(overdueRows[0].total_count) : 0,
      },
      crewShortage: {
        items: crewShortageItems,
        total: crewShortageRows.length > 0 ? Number(crewShortageRows[0].total_count) : 0,
      },
      staleDispatch: {
        items: staleDispatchItems,
        total: staleDispatchRows.length > 0 ? Number(staleDispatchRows[0].total_count) : 0,
      },
    };
  }
}
