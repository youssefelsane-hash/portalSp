import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { SettingsService } from '../settings/settings.service';
import {
  deriveMatchingWorkflowState,
  MatchingWorkflowState,
} from '../matching/matching-workflow-state';
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
  /** رقم الطلب الإنساني — الأدمن كان بيشوف "عرض الطلب" بس بلا أي هوية للطلب. */
  orderNumber: string;
  /** كام فني **مختلف** الطلب ده اتبعتله فعلًا (كل الجولات + فرص الشغل، بلا حدود النافذة الزمنية
   *  للتبويب) — بلاغ المالك: «الطلب لما يتبعت لكذا حد ما بيبانليش اتبعت لكام». */
  orderTechnicianCount: number;
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
  order_number: string;
  order_technician_count: string;
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
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * **التحكم اللحظي في التوزيع** — كل طلب لسه بيدوّر على فني، بجولته الحالية وعدّاداته والخطوة
   * الجاية وحالته الصحية.
   *
   * موجودة هنا مش في خدمة جديدة لأن الملف ده هو بالفعل «مراقبة تسليم الطلبات» — الفرق إن
   * `getDeliveryObservability()` بترجّع **feed مسطح بالزمن** (مفيد لمتابعة الأحداث لحظة بلحظة)،
   * ودي بترجّع **صف لكل طلب** (مفيد للسؤال «إيه اللي واقف دلوقتي»). نفس الجداول، نفس الحقيقة،
   * سؤالين مختلفين — فالاتنين فاضلين.
   *
   * **استعلام واحد مجمّع**: صف لكل طلب فيه كل العدّادات. مفيش نداء لكل طلب مهما كان العدد.
   * والاشتقاق (الخطوة الجاية/التأخير) بيتم بنفس `deriveMatchingWorkflowState` اللي صفحة الطلب
   * وException Center بيستخدموها.
   */
  async getLiveDispatch(filters: {
    categoryId: string | null;
    zoneId: string | null;
    onlyDelayed: boolean;
  }): Promise<LiveDispatchResult> {
    const [maxRounds, graceSeconds] = await Promise.all([
      this.settingsService.getNumber('matching.max_rounds', 4),
      this.settingsService.getNumber('matching.workflow_delay_grace_seconds', 60),
    ]);

    const rows = await this.dataSource.query<RawLiveDispatchRow[]>(
      `
      WITH per_order AS (
        SELECT oa.order_id,
               MAX(oa.assignment_round) AS current_round,
               COUNT(DISTINCT oa.technician_id) AS technicians_contacted,
               COUNT(*) FILTER (WHERE oa.assignment_status IN ('sent', 'viewed')) AS pending,
               COUNT(*) FILTER (WHERE oa.viewed_at IS NOT NULL OR oa.assignment_status = 'viewed') AS viewed,
               COUNT(*) FILTER (WHERE oa.assignment_status = 'rejected') AS rejected,
               COUNT(*) FILTER (WHERE oa.assignment_status = 'accepted') AS accepted
          FROM order_assignments oa
         GROUP BY oa.order_id
      )
      SELECT o.id, o.order_number, o.order_status::text AS order_status, o.booking_mode::text AS booking_mode,
             o.order_type::text AS order_type, o.placed_at, s.name_ar AS service_name_ar,
             COALESCE(po.current_round, 0) AS current_round,
             COALESCE(po.technicians_contacted, 0) AS technicians_contacted,
             COALESCE(po.pending, 0) AS pending,
             COALESCE(po.viewed, 0) AS viewed,
             COALESCE(po.rejected, 0) AS rejected,
             COALESCE(po.accepted, 0) AS accepted,
             (SELECT MAX(cur.expires_at) FROM order_assignments cur
               WHERE cur.order_id = o.id AND cur.assignment_round = po.current_round) AS round_expands_at,
             -- العدد الحقيقي **قبل** الـLIMIT: من غيره الشاشة بتقول «65 طلب بيدوّر» وهي شايفة
             -- 200 من 400، والأدمن مش هيعرف إن فيه طلبات متخبّية.
             COUNT(*) OVER() AS total_count
        FROM orders o
        JOIN services s ON s.id = o.service_id
        LEFT JOIN per_order po ON po.order_id = o.id
       WHERE o.order_status = 'searching_technician'
         AND o.deleted_at IS NULL
         AND ($1::uuid IS NULL OR s.category_id = $1)
         AND ($2::uuid IS NULL OR o.service_zone_id = $2)
       -- الأقدم الأول: الطلب اللي قاعد بيدوّر من ساعتين أهم من اللي دخل دلوقتي، ولو الحد اتخطى
       -- فالمقصوص هو الأحدث — أقل ضررًا من قصّ الأقدم.
       ORDER BY o.placed_at ASC
       LIMIT ${LIVE_DISPATCH_MAX_ROWS}
      `,
      [filters.categoryId, filters.zoneId],
    );

    const now = new Date();
    const items: LiveDispatchRow[] = rows.map((r) => {
      const workflow = deriveMatchingWorkflowState({
        orderStatus: r.order_status as never,
        currentRound: Number(r.current_round),
        roundExpansionDueAt: r.round_expands_at ? new Date(r.round_expands_at) : null,
        pendingInCurrentRound: Number(r.pending),
        maxRounds,
        graceSeconds,
        now,
      });
      return {
        orderId: r.id,
        orderNumber: r.order_number,
        serviceNameAr: r.service_name_ar,
        bookingMode: r.booking_mode,
        orderType: r.order_type,
        searchingSinceSeconds: Math.max(0, Math.floor((now.getTime() - new Date(r.placed_at).getTime()) / 1000)),
        currentRound: Number(r.current_round),
        maxRounds,
        techniciansContacted: Number(r.technicians_contacted),
        pending: Number(r.pending),
        viewed: Number(r.viewed),
        rejected: Number(r.rejected),
        accepted: Number(r.accepted),
        workflow,
      };
    });

    // الفلترة على `isDelayed` بتتم هنا مش في SQL عن قصد: القاعدة موجودة في مكان واحد
    // (`deriveMatchingWorkflowState`)، وكتابتها تاني كـ`WHERE` كانت هترجّعنا لنسختين بتفترقوا مع
    // أول تعديل في مهلة السماح أو سقف الجولات. الثمن إن الفلتر بيشتغل على النافذة المحمّلة بس —
    // وعشان كده `totalSearching`/`truncated` بيتقالوا للواجهة صراحةً بدل ما الرقم يكدب.
    const totalSearching = rows.length > 0 ? Number(rows[0].total_count) : 0;
    return {
      items: filters.onlyDelayed ? items.filter((i) => i.workflow.isDelayed) : items,
      totalSearching,
      truncated: totalSearching > LIVE_DISPATCH_MAX_ROWS,
    };
  }

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
        -- 'viewed' برضه متأخر لو فات معاده بلا رد (docs/08 §72).
        COUNT(*) FILTER (WHERE assignment_status IN ('sent', 'viewed') AND expires_at < now()) AS a_stale_sent,
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
               (oa.assignment_status IN ('sent', 'viewed') AND oa.expires_at < now()) AS is_stale
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
             ord.order_number,
             -- "اتبعت لكام فني" على مستوى الطلب: فنيين **مختلفين** عبر كل الجولات وكل فرص الشغل،
             -- **بلا** قيد النافذة الزمنية للتبويب — السؤال إجماليّ عن الطلب نفسه، مش عن آخر N
             -- ساعة. subquery محدودة بصفحة العرض (≤ perPage صف)، مش مسح كامل.
             (
               SELECT COUNT(*) FROM (
                 SELECT technician_id FROM order_assignments WHERE order_id = f.order_id
                 UNION
                 SELECT technician_id FROM technician_work_opportunities
                  WHERE order_id = f.order_id AND deleted_at IS NULL
               ) d
             ) AS order_technician_count,
             COUNT(*) OVER() AS total_count
      FROM feed f
      JOIN technician_profiles tp ON tp.id = f.technician_id
      JOIN users u ON u.id = tp.user_id
      JOIN orders ord ON ord.id = f.order_id
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
      orderNumber: r.order_number,
      orderTechnicianCount: Number(r.order_technician_count),
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

/**
 * سقف صفوف «التحكم اللحظي». مش ترقيم صفحات: الشاشة دي لمحة تشغيلية، والأدمن بيفلتر بالفئة/النطاق
 * لما العدد يكبر. بس السقف **مُعلَن** للواجهة (`truncated`) مش مسكوت عنه — شاشة شغلها «ورّيني
 * اللي واقف» ممنوع تخبّي طلب واقف في صمت.
 */
const LIVE_DISPATCH_MAX_ROWS = 200;

/** نتيجة «التحكم اللحظي في التوزيع» — الصفوف + العدد الحقيقي قبل القصّ. */
export interface LiveDispatchResult {
  items: LiveDispatchRow[];
  /** كل الطلبات اللي بتدوّر ومطابقة للفلاتر — **قبل** السقف وقبل فلتر «المتأخر بس». */
  totalSearching: number;
  /** `true` لما العدد الحقيقي عدّى السقف، يعني في صفوف مش معروضة. */
  truncated: boolean;
}

/** صف «التحكم اللحظي في التوزيع» — طلب واحد بيدوّر، بحالته الكاملة. */
export interface LiveDispatchRow {
  orderId: string;
  orderNumber: string;
  serviceNameAr: string;
  bookingMode: string;
  orderType: string;
  /** بيدوّر من كام ثانية — الواجهة بتحوّلها لعدّاد، مابتحسبش وقت من عندها. */
  searchingSinceSeconds: number;
  currentRound: number;
  maxRounds: number;
  techniciansContacted: number;
  pending: number;
  viewed: number;
  rejected: number;
  accepted: number;
  workflow: MatchingWorkflowState;
}

interface RawLiveDispatchRow {
  id: string;
  order_number: string;
  order_status: string;
  booking_mode: string;
  order_type: string;
  placed_at: string;
  service_name_ar: string;
  current_round: string;
  technicians_contacted: string;
  pending: string;
  viewed: string;
  rejected: string;
  accepted: string;
  round_expands_at: string | null;
  total_count: string;
}
