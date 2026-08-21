import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ESCALATABLE_STATUSES } from '../orders/crew-shortage-escalation.service';
import { computeCrewComposition } from '../orders/order-team.service';

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
  technicianId: string;
  technicianCode: string;
  fullName: string;
  sentAt: string;
  expiresAt: string;
}

export interface AdminExceptionCenterResult {
  crewShortage: { items: CrewShortageExceptionItem[]; total: number };
  staleDispatch: { items: StaleDispatchExceptionItem[]; total: number };
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

interface RawStaleDispatchRow {
  id: string;
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
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

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
      SELECT oa.id, oa.order_id, oa.technician_id, tp.technician_code, u.full_name,
             oa.sent_at, oa.expires_at, COUNT(*) OVER() AS total_count
      FROM order_assignments oa
      JOIN orders o ON o.id = oa.order_id
      JOIN services s ON s.id = o.service_id
      JOIN technician_profiles tp ON tp.id = oa.technician_id
      JOIN users u ON u.id = tp.user_id
      WHERE oa.assignment_status = 'sent' AND oa.expires_at < now()
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
      technicianId: r.technician_id,
      technicianCode: r.technician_code,
      fullName: r.full_name,
      sentAt: r.sent_at,
      expiresAt: r.expires_at,
    }));

    return {
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
