import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AssignmentStatus } from '../matching/entities/order-assignment.entity';
import { WorkOpportunityContext, WorkOpportunityStatus } from '../technicians/technician-work-opportunities.service';

export interface DispatchDeliveryFilters {
  categoryId?: string | null;
  zoneId?: string | null;
  hours: number;
  page: number;
  perPage: number;
}

export interface AssignmentStatusCounts {
  sent: number;
  viewed: number;
  accepted: number;
  rejected: number;
  timeout: number;
  cancelled: number;
  staleSentCount: number;
}

export interface WorkOpportunityStatusCounts {
  offered: number;
  accepted: number;
  declined: number;
  closed: number;
}

export interface DispatchDeliverySummary {
  assignments: AssignmentStatusCounts;
  workOpportunities: WorkOpportunityStatusCounts;
}

export interface DispatchDeliveryRow {
  id: string;
  kind: 'assignment' | 'work_opportunity';
  orderId: string;
  technicianId: string;
  technicianCode: string;
  fullName: string;
  status: AssignmentStatus | WorkOpportunityStatus;
  context: WorkOpportunityContext | null;
  sentAt: string;
  respondedAt: string | null;
  expiresAt: string | null;
  isStale: boolean;
}

interface RawRow {
  id: string;
  kind: 'assignment' | 'work_opportunity';
  order_id: string;
  technician_id: string;
  technician_code: string;
  full_name: string;
  status: string;
  context: string | null;
  sent_at: string;
  responded_at: string | null;
  expires_at: string | null;
  is_stale: boolean;
  total_count: string;
}

interface SummaryRow {
  a_sent: string;
  a_viewed: string;
  a_accepted: string;
  a_rejected: string;
  a_timeout: string;
  a_cancelled: string;
  a_stale_sent: string;
  wo_offered: string;
  wo_accepted: string;
  wo_declined: string;
  wo_closed: string;
}

/**
 * مراقبة تسليم الطلبات (docs/08 §36.7) — "REQ SENT + حالات حقيقية بس"، صفر حالة توصيل مُخترعة.
 * بيجمع مصدرين حقيقيين موجودين بالفعل بلا أي طبقة تتبّع توصيل موازية جديدة:
 *  - `order_assignments` (البث المباشر/الطوارئ لكل جولة، `AssignmentStatus`) — عنده `expires_at`
 *    حقيقي، فبنقدر نحسب `stale_sent_count` (صف لسه `sent` بعد ما فات معاده — يعني على الأغلب
 *    processor انتهاء الجولة (`matching-round-expiry.processor.ts`) لسه ما لحقهوش، مش حالة مخترعة،
 *    استنتاج مباشر من `expires_at` الحقيقي المخزّن وقت الإرسال).
 *  - `technician_work_opportunities` (فرص الشغل الإضافي الاختياري/تجنيد الفريق، docs/08 §34.1/§35)
 *    — **مفيهاش `expires_at`** أصلاً (migration 0153: الفرصة تفضل صالحة لحد قرار/تغطية الطلب)،
 *    فـ`isStale` بتفضل `false` دايمًا للنوع ده عمدًا — مفيش عتبة وقت تعسفية مخترعة هنا.
 *
 * **بَقّة حقيقية اتلقطت وقت التحقق الحي، مش نظرية**: `ResponseInterceptor` (common/interceptors)
 * بيعمل auto-unwrap لأي payload فيه مفتاحي `items`+`meta` (بغض النظر عن أي مفاتيح تانية موجودة
 * جنبهم) — لو الدالة دي كانت بترجّع `{summary, items, meta}` على المستوى الأول، الـinterceptor كان
 * هيقطع `summary` بصمت تام (لا خطأ، لا تحذير) ويسيب `data` = الـitems array بس. اتلقطت فعليًا بـcurl
 * حي ضد Postgres/Redis حقيقيين (مش نظريًا) — `summary` كانت بتختفي تمامًا من الرد. الحل: تعشيش
 * `items`/`meta` تحت مفتاح `feed` منفصل (`{summary, feed: {items, meta}}`) بدل ما يبقوا على نفس
 * مستوى `summary` — الـinterceptor بيفحص المستوى الأول بس، فمبيلمسش `feed` جوّه.
 */
@Injectable()
export class AdminDispatchDeliveryService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getDeliveryObservability(filters: DispatchDeliveryFilters): Promise<{
    summary: DispatchDeliverySummary;
    feed: { items: DispatchDeliveryRow[]; meta: { page: number; perPage: number; total: number } };
  }> {
    const offset = (filters.page - 1) * filters.perPage;

    const [summaryRow] = await this.dataSource.query<SummaryRow[]>(
      `
      WITH assignments_filtered AS (
        SELECT oa.assignment_status, oa.expires_at
        FROM order_assignments oa
        JOIN orders o ON o.id = oa.order_id
        JOIN services s ON s.id = o.service_id
        WHERE oa.sent_at >= now() - make_interval(hours => $3::int)
          AND ($1::uuid IS NULL OR s.category_id = $1)
          AND ($2::uuid IS NULL OR o.service_zone_id = $2)
      ),
      wo_filtered AS (
        SELECT wo.status
        FROM technician_work_opportunities wo
        JOIN orders o ON o.id = wo.order_id
        JOIN services s ON s.id = o.service_id
        WHERE wo.deleted_at IS NULL AND wo.offered_at >= now() - make_interval(hours => $3::int)
          AND ($1::uuid IS NULL OR s.category_id = $1)
          AND ($2::uuid IS NULL OR o.service_zone_id = $2)
      )
      SELECT
        COUNT(*) FILTER (WHERE assignment_status = 'sent') AS a_sent,
        COUNT(*) FILTER (WHERE assignment_status = 'viewed') AS a_viewed,
        COUNT(*) FILTER (WHERE assignment_status = 'accepted') AS a_accepted,
        COUNT(*) FILTER (WHERE assignment_status = 'rejected') AS a_rejected,
        COUNT(*) FILTER (WHERE assignment_status = 'timeout') AS a_timeout,
        COUNT(*) FILTER (WHERE assignment_status = 'cancelled') AS a_cancelled,
        COUNT(*) FILTER (WHERE assignment_status = 'sent' AND expires_at < now()) AS a_stale_sent,
        (SELECT COUNT(*) FILTER (WHERE status = 'offered') FROM wo_filtered) AS wo_offered,
        (SELECT COUNT(*) FILTER (WHERE status = 'accepted') FROM wo_filtered) AS wo_accepted,
        (SELECT COUNT(*) FILTER (WHERE status = 'declined') FROM wo_filtered) AS wo_declined,
        (SELECT COUNT(*) FILTER (WHERE status = 'closed') FROM wo_filtered) AS wo_closed
      FROM assignments_filtered
      `,
      [filters.categoryId ?? null, filters.zoneId ?? null, filters.hours],
    );

    const rawRows = await this.dataSource.query<RawRow[]>(
      `
      WITH assignments_filtered AS (
        SELECT oa.id, oa.order_id, oa.technician_id, oa.assignment_status::text AS status,
               oa.sent_at, oa.responded_at, oa.expires_at,
               (oa.assignment_status = 'sent' AND oa.expires_at < now()) AS is_stale
        FROM order_assignments oa
        JOIN orders o ON o.id = oa.order_id
        JOIN services s ON s.id = o.service_id
        WHERE oa.sent_at >= now() - make_interval(hours => $3::int)
          AND ($1::uuid IS NULL OR s.category_id = $1)
          AND ($2::uuid IS NULL OR o.service_zone_id = $2)
      ),
      wo_filtered AS (
        SELECT wo.id, wo.order_id, wo.technician_id, wo.status::text AS status, wo.context::text AS context,
               wo.offered_at AS sent_at, wo.decided_at AS responded_at
        FROM technician_work_opportunities wo
        JOIN orders o ON o.id = wo.order_id
        JOIN services s ON s.id = o.service_id
        WHERE wo.deleted_at IS NULL AND wo.offered_at >= now() - make_interval(hours => $3::int)
          AND ($1::uuid IS NULL OR s.category_id = $1)
          AND ($2::uuid IS NULL OR o.service_zone_id = $2)
      ),
      feed AS (
        SELECT id, 'assignment'::text AS kind, order_id, technician_id, status, NULL::text AS context,
               sent_at, responded_at, expires_at, is_stale
        FROM assignments_filtered
        UNION ALL
        SELECT id, 'work_opportunity'::text AS kind, order_id, technician_id, status, context,
               sent_at, responded_at, NULL::timestamptz AS expires_at, false AS is_stale
        FROM wo_filtered
      )
      SELECT f.id, f.kind, f.order_id, f.technician_id, tp.technician_code, u.full_name,
             f.status, f.context, f.sent_at, f.responded_at, f.expires_at, f.is_stale,
             COUNT(*) OVER() AS total_count
      FROM feed f
      JOIN technician_profiles tp ON tp.id = f.technician_id
      JOIN users u ON u.id = tp.user_id
      ORDER BY f.sent_at DESC
      LIMIT $4 OFFSET $5
      `,
      [filters.categoryId ?? null, filters.zoneId ?? null, filters.hours, filters.perPage, offset],
    );

    const total = rawRows.length > 0 ? Number(rawRows[0].total_count) : 0;
    const items: DispatchDeliveryRow[] = rawRows.map((r) => ({
      id: r.id,
      kind: r.kind,
      orderId: r.order_id,
      technicianId: r.technician_id,
      technicianCode: r.technician_code,
      fullName: r.full_name,
      status: r.status as AssignmentStatus | WorkOpportunityStatus,
      context: (r.context as WorkOpportunityContext | null) ?? null,
      sentAt: r.sent_at,
      respondedAt: r.responded_at,
      expiresAt: r.expires_at,
      isStale: r.is_stale,
    }));

    const summary: DispatchDeliverySummary = summaryRow
      ? {
          assignments: {
            sent: Number(summaryRow.a_sent),
            viewed: Number(summaryRow.a_viewed),
            accepted: Number(summaryRow.a_accepted),
            rejected: Number(summaryRow.a_rejected),
            timeout: Number(summaryRow.a_timeout),
            cancelled: Number(summaryRow.a_cancelled),
            staleSentCount: Number(summaryRow.a_stale_sent),
          },
          workOpportunities: {
            offered: Number(summaryRow.wo_offered),
            accepted: Number(summaryRow.wo_accepted),
            declined: Number(summaryRow.wo_declined),
            closed: Number(summaryRow.wo_closed),
          },
        }
      : {
          assignments: { sent: 0, viewed: 0, accepted: 0, rejected: 0, timeout: 0, cancelled: 0, staleSentCount: 0 },
          workOpportunities: { offered: 0, accepted: 0, declined: 0, closed: 0 },
        };

    return { summary, feed: { items, meta: { page: filters.page, perPage: filters.perPage, total } } };
  }
}
