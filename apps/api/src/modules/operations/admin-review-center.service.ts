import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * **مركز المراجعة والشواذ** (ADR-0084، طلب مالك docs/08 §139) — قراءة وتجميع بس، صفر قرار.
 *
 * ## ليه منفصل عن مركز الاستثناءات اللي جنبه
 *
 * الاتنين بيعرضوا «حاجة محتاجة انتباه»، بس بيجاوبوا سؤالين مختلفين تمامًا:
 *
 * - **مركز الاستثناءات** (`admin-exception-center.service.ts`): النظام **مااتحركش** — طلب معداه
 *   عدّى، مطابقة واقفة، مهلة خلصت. الشغل المطلوب: **حرّك**.
 * - **مركز المراجعة** (هنا): حد **اتحرّك** بطريقة محتاجة حكم بشري — الفني زوّد فلوس، بلّغ نشو،
 *   قال إنه ماستلمش كاش. الشغل المطلوب: **راجع واحكم**.
 *
 * خلطهم في قايمة واحدة كان هيخلي «الأدمن بيبص فين؟» سؤال ليه إجابتين.
 *
 * ## القاعدة الحاكمة: النص الحرفي، مش ملخّص
 *
 * كل صف هنا بيرجّع **اللي الفني كتبه بالحرف** (التشخيص، وصف البند، سبب البلاغ). ده كل الغرض من
 * الشاشة: المالك قال «عايز أدوّر ورا الصنايعية وأشوف إيه اللي ماشي مضبوط وإيه اللي فيه تلاعب».
 * رقم بلا نص مابيراجعش حاجة.
 */
const REVIEW_LIST_LIMIT = 100;

export interface ReviewCenterFilters {
  /** فلترة على فني بعينه — «أدوّر ورا صنايعي معيّن». */
  technicianId?: string | null;
  /** `true` = المعلّق بس (محتاج قرار دلوقتي)، `false`/غياب = كل حاجة في المدى الزمني. */
  pendingOnly?: boolean;
  /** عدد الأيام للخلف (افتراضي ٣٠) — السجل بيكبر، والمراجعة بتحصل على المدى القريب. */
  sinceDays?: number;
}

/** فعل مالي واحد من الفني — بند مقترح أو عرض سعر. المصدران بيتوحّدوا في شكل واحد عشان الشاشة
 *  تعرضهم في قايمة واحدة مرتبة بالوقت بدل جدولين منفصلين بيتقروا بالتبادل. */
export interface TechnicianMoneyActionItem {
  kind: 'order_item' | 'quote';
  id: string;
  orderId: string;
  orderNumber: string;
  /** `spare_part` / `extra_labor` / `addon` للبنود، أو مصدر العرض (`technician_onsite`…). */
  actionType: string;
  status: string;
  /**
   * **«لسه محتاج قرار»** موحّد بين المصدرين (ADR-0084).
   *
   * الجدولين بيستخدموا مفردات حالة مختلفة تمامًا: `order_items.proposal_status = 'pending'`،
   * بينما `order_quotes.status` بتبقى `pending_admin_review` أو `pending_customer`. فلترة على
   * نص `'pending'` حرفيًا كانت هتسقط **كل** عروض الأسعار من قايمة المعلّق بصمت — وهي أهم بند
   * في الشاشة. التوحيد بيحصل في الاستعلام، والواجهة بتقرا راية واحدة.
   */
  isPending: boolean;
  amountCents: number;
  /** اسم البند، أو `null` للعروض (العرض مالوش اسم — ليه تشخيص). */
  nameAr: string | null;
  /** **النص اللي الفني كتبه** — وصف البند أو تشخيص المعاينة. */
  justification: string | null;
  /** نطاق الشغل الداخل/الخارج (العروض بس) — بيوضّح الفني وعد بإيه بالظبط. */
  scopeIncluded: string | null;
  scopeExcluded: string | null;
  /** سبب مراجعة العرض لما يكون نسخة تانية — «ليه غيّرت السعر؟». */
  revisionReason: string | null;
  /** `true` لو الصف اتكتب قبل ما التبرير يبقى إجباري (ADR-0084 §2) — الواجهة بتعلّمه. */
  justificationMissing: boolean;
  technicianId: string | null;
  technicianName: string | null;
  submittedByUserId: string;
  createdAt: string;
}

export interface FailedVisitItem {
  orderId: string;
  orderNumber: string;
  technicianId: string | null;
  technicianName: string | null;
  customerName: string | null;
  /** السبب المقفول (`customer_no_show` / `required_work_rejected` / `other`) من الشكوى المرتبطة. */
  reasonCategory: string | null;
  /** النص اللي الفني كتبه وقت البلاغ — مخزّن في `order_status_history.reason`. */
  description: string | null;
  reportedAt: string;
  scheduledAt: string | null;
  totalAmountCents: number;
}

export interface CashDisputeItem {
  orderId: string;
  orderNumber: string;
  technicianId: string | null;
  technicianName: string | null;
  customerName: string | null;
  totalAmountCents: number;
  customerCashConfirmedAt: string | null;
  technicianCashNotReceivedAt: string | null;
  /** `true` = العميل بيقول دفع والفني بيقول ماستلمش — تضارب صريح، أخطر حالة. */
  isConflict: boolean;
  orderStatus: string;
}

export interface UnresolvedComplaintItem {
  complaintId: string;
  complaintNumber: string;
  orderId: string | null;
  orderNumber: string | null;
  category: string;
  severity: string;
  title: string;
  filedByName: string | null;
  filedByType: string | null;
  againstName: string | null;
  againstType: string | null;
  slaDueAt: string;
  isOverdue: boolean;
  createdAt: string;
}

export interface AdminReviewCenterResult {
  technician_money_actions: { items: TechnicianMoneyActionItem[]; total: number; pending: number };
  failed_visits: { items: FailedVisitItem[]; total: number };
  cash_disputes: { items: CashDisputeItem[]; total: number; conflicts: number };
  unresolved_complaints: { items: UnresolvedComplaintItem[]; total: number; overdue: number };
}

@Injectable()
export class AdminReviewCenterService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getReviewCenter(filters: ReviewCenterFilters = {}): Promise<AdminReviewCenterResult> {
    const technicianId = filters.technicianId ?? null;
    const sinceDays = Math.min(Math.max(filters.sinceDays ?? 30, 1), 365);
    const pendingOnly = filters.pendingOnly === true;

    const [moneyActions, failedVisits, cashDisputes, complaints] = await Promise.all([
      this.technicianMoneyActions(technicianId, sinceDays, pendingOnly),
      this.failedVisits(technicianId, sinceDays),
      this.cashDisputes(technicianId, sinceDays),
      this.unresolvedComplaints(sinceDays),
    ]);

    return {
      technician_money_actions: {
        items: moneyActions,
        total: moneyActions.length,
        pending: moneyActions.filter((a) => a.isPending).length,
      },
      failed_visits: { items: failedVisits, total: failedVisits.length },
      cash_disputes: {
        items: cashDisputes,
        total: cashDisputes.length,
        conflicts: cashDisputes.filter((c) => c.isConflict).length,
      },
      unresolved_complaints: {
        items: complaints,
        total: complaints.length,
        overdue: complaints.filter((c) => c.isOverdue).length,
      },
    };
  }

  /**
   * كل فعل من الفني بيزوّد فلوس الطلب — من **المصدرين** في استعلام واحد.
   *
   * `order_items` (بنود إضافية أثناء الشغل) و`order_quotes` (سعر بعد معاينة) جدولين مختلفين
   * بعقدين مختلفين، بس بالنسبة للأدمن دول نفس الحدث: «الفني طلب فلوس زيادة وكتب ليه». التوحيد
   * هنا بـUNION عشان القايمة تترتب زمنيًا صح — لو اتقروا منفصلين، فعلين على نفس الطلب فرق
   * بينهم دقيقة كانوا هيبانوا في مكانين بعيدين.
   */
  private async technicianMoneyActions(
    technicianId: string | null,
    sinceDays: number,
    pendingOnly: boolean,
  ): Promise<TechnicianMoneyActionItem[]> {
    const rows = await this.dataSource.query<
      {
        kind: 'order_item' | 'quote';
        id: string;
        order_id: string;
        order_number: string;
        action_type: string;
        status: string;
        is_pending: boolean;
        amount_cents: number;
        name_ar: string | null;
        justification: string | null;
        scope_included: string | null;
        scope_excluded: string | null;
        revision_reason: string | null;
        technician_id: string | null;
        technician_name: string | null;
        submitted_by_user_id: string;
        created_at: Date;
      }[]
    >(
      `
      WITH items AS (
        SELECT 'order_item'::text AS kind, oi.id, oi.order_id, o.order_number,
               oi.item_type::text AS action_type, oi.proposal_status AS status,
               (oi.proposal_status = 'pending') AS is_pending,
               oi.total_price_cents AS amount_cents, oi.name_ar,
               oi.description AS justification,
               NULL::text AS scope_included, NULL::text AS scope_excluded, NULL::text AS revision_reason,
               o.technician_id, u.full_name AS technician_name,
               oi.added_by_user_id AS submitted_by_user_id, oi.created_at
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN technician_profiles tp ON tp.id = o.technician_id
        LEFT JOIN users u ON u.id = tp.user_id
        WHERE o.deleted_at IS NULL
          -- بند الخدمة الأساسي بيتحدد من الكتالوج وقت الحجز، مش فعل من الفني — بره النطاق.
          AND oi.item_type::text <> 'service'
          AND oi.created_at >= now() - ($1 || ' days')::interval
      ),
      quotes AS (
        SELECT 'quote'::text AS kind, q.id, q.order_id, o.order_number,
               q.source AS action_type, q.status,
               (q.status IN ('pending_admin_review', 'pending_customer')) AS is_pending,
               q.amount_cents, NULL::varchar AS name_ar,
               q.diagnosis AS justification,
               q.scope_included, q.scope_excluded, q.revision_reason,
               o.technician_id, u.full_name AS technician_name,
               q.submitted_by_user_id, q.created_at
        FROM order_quotes q
        JOIN orders o ON o.id = q.order_id
        LEFT JOIN technician_profiles tp ON tp.id = o.technician_id
        LEFT JOIN users u ON u.id = tp.user_id
        WHERE o.deleted_at IS NULL
          AND q.created_at >= now() - ($1 || ' days')::interval
      ),
      merged AS (SELECT * FROM items UNION ALL SELECT * FROM quotes)
      SELECT * FROM merged
      WHERE ($2::uuid IS NULL OR technician_id = $2::uuid)
        AND ($3::boolean IS FALSE OR is_pending)
      ORDER BY created_at DESC
      LIMIT $4
      `,
      [String(sinceDays), technicianId, pendingOnly, REVIEW_LIST_LIMIT],
    );

    return rows.map((r) => ({
      kind: r.kind,
      id: r.id,
      orderId: r.order_id,
      orderNumber: r.order_number,
      actionType: r.action_type,
      status: r.status,
      isPending: r.is_pending,
      amountCents: Number(r.amount_cents),
      nameAr: r.name_ar,
      justification: r.justification,
      scopeIncluded: r.scope_included,
      scopeExcluded: r.scope_excluded,
      revisionReason: r.revision_reason,
      // الصفوف اللي اتكتبت قبل ADR-0084 §2 ممكن تكون بلا تبرير — بتتعلّم مش بتتخفي.
      justificationMissing: !r.justification || r.justification.trim().length === 0,
      technicianId: r.technician_id,
      technicianName: r.technician_name,
      submittedByUserId: r.submitted_by_user_id,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  /**
   * النشو — الزيارة اللي راحت ومفيش شغل اتعمل.
   *
   * السبب المقفول بيتخزّن في الشكوى اللي `reportFailedVisit()` بيفتحها تلقائيًا، والنص الحر
   * بيتخزّن في `order_status_history.reason` على انتقال `→ disputed`. الاتنين محتاجين لبعض:
   * التصنيف بيتفلتر عليه، والنص هو اللي بيتقرا.
   */
  private async failedVisits(technicianId: string | null, sinceDays: number): Promise<FailedVisitItem[]> {
    const rows = await this.dataSource.query<
      {
        order_id: string;
        order_number: string;
        technician_id: string | null;
        technician_name: string | null;
        customer_name: string | null;
        reason_category: string | null;
        description: string | null;
        reported_at: Date;
        scheduled_at: Date | null;
        total_amount_cents: number;
      }[]
    >(
      `
      SELECT o.id AS order_id, o.order_number, o.technician_id,
             tu.full_name AS technician_name, cu.full_name AS customer_name,
             c.category AS reason_category,
             h.reason AS description,
             h.created_at AS reported_at,
             o.scheduled_at, o.total_amount_cents
      FROM orders o
      JOIN LATERAL (
        SELECT osh.reason, osh.created_at
        FROM order_status_history osh
        WHERE osh.order_id = o.id AND osh.new_status = 'disputed'
        ORDER BY osh.created_at DESC
        LIMIT 1
      ) h ON TRUE
      LEFT JOIN technician_profiles tp ON tp.id = o.technician_id
      LEFT JOIN users tu ON tu.id = tp.user_id
      LEFT JOIN customer_profiles cp ON cp.id = o.customer_id
      LEFT JOIN users cu ON cu.id = cp.user_id
      LEFT JOIN LATERAL (
        SELECT cc.category FROM complaints cc
        WHERE cc.order_id = o.id AND cc.category IN ('no_show', 'required_work_rejected', 'other')
        ORDER BY cc.created_at DESC LIMIT 1
      ) c ON TRUE
      WHERE o.deleted_at IS NULL
        AND o.order_status = 'disputed'
        AND h.created_at >= now() - ($1 || ' days')::interval
        AND ($2::uuid IS NULL OR o.technician_id = $2::uuid)
      ORDER BY h.created_at DESC
      LIMIT $3
      `,
      [String(sinceDays), technicianId, REVIEW_LIST_LIMIT],
    );

    return rows.map((r) => ({
      orderId: r.order_id,
      orderNumber: r.order_number,
      technicianId: r.technician_id,
      technicianName: r.technician_name,
      customerName: r.customer_name,
      reasonCategory: r.reason_category,
      description: r.description,
      reportedAt: new Date(r.reported_at).toISOString(),
      scheduledAt: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null,
      totalAmountCents: Number(r.total_amount_cents),
    }));
  }

  /**
   * الكاش اللي ماوصلش — أخطر بند مالي في الشاشة.
   *
   * حالتان مختلفتان بتتعرضا مع بعض عن قصد: الفني بلّغ إنه ماستلمش (`technician_cash_not_received_at`)،
   * والعميل مؤكّد إنه سلّم (`customer_cash_confirmed_at`). لو الاتنين موجودين ⇒ **تضارب صريح**
   * (`isConflict`) — طرف بيقول دفعت وطرف بيقول ماستلمتش، ومحدش غير الأدمن يقدر يحسمها.
   */
  private async cashDisputes(technicianId: string | null, sinceDays: number): Promise<CashDisputeItem[]> {
    const rows = await this.dataSource.query<
      {
        order_id: string;
        order_number: string;
        technician_id: string | null;
        technician_name: string | null;
        customer_name: string | null;
        total_amount_cents: number;
        customer_cash_confirmed_at: Date | null;
        technician_cash_not_received_at: Date | null;
        order_status: string;
      }[]
    >(
      `
      SELECT o.id AS order_id, o.order_number, o.technician_id,
             tu.full_name AS technician_name, cu.full_name AS customer_name,
             o.total_amount_cents, o.customer_cash_confirmed_at, o.technician_cash_not_received_at,
             o.order_status::text AS order_status
      FROM orders o
      LEFT JOIN technician_profiles tp ON tp.id = o.technician_id
      LEFT JOIN users tu ON tu.id = tp.user_id
      LEFT JOIN customer_profiles cp ON cp.id = o.customer_id
      LEFT JOIN users cu ON cu.id = cp.user_id
      WHERE o.deleted_at IS NULL
        AND o.technician_cash_not_received_at IS NOT NULL
        AND o.technician_cash_not_received_at >= now() - ($1 || ' days')::interval
        AND ($2::uuid IS NULL OR o.technician_id = $2::uuid)
      ORDER BY o.technician_cash_not_received_at DESC
      LIMIT $3
      `,
      [String(sinceDays), technicianId, REVIEW_LIST_LIMIT],
    );

    return rows.map((r) => ({
      orderId: r.order_id,
      orderNumber: r.order_number,
      technicianId: r.technician_id,
      technicianName: r.technician_name,
      customerName: r.customer_name,
      totalAmountCents: Number(r.total_amount_cents),
      customerCashConfirmedAt: r.customer_cash_confirmed_at ? new Date(r.customer_cash_confirmed_at).toISOString() : null,
      technicianCashNotReceivedAt: r.technician_cash_not_received_at
        ? new Date(r.technician_cash_not_received_at).toISOString()
        : null,
      isConflict: r.customer_cash_confirmed_at !== null,
      orderStatus: r.order_status,
    }));
  }

  /**
   * الشكاوى المفتوحة — **بأطرافها** (ADR-0084 §3).
   *
   * الشاشة دي مش بديل صفحة الشكاوى الكاملة؛ هي شريحة «لسه بلا حسم» عشان تبان جنب باقي الشواذ.
   * الفرق اللي بيخليها تستاهل مكان هنا إن الطرفين ظاهرين بالاسم — وده اللي كان ناقص أصلاً.
   */
  private async unresolvedComplaints(sinceDays: number): Promise<UnresolvedComplaintItem[]> {
    const rows = await this.dataSource.query<
      {
        complaint_id: string;
        complaint_number: string;
        order_id: string | null;
        order_number: string | null;
        category: string;
        severity: string;
        title: string;
        filed_by_name: string | null;
        filed_by_type: string | null;
        against_name: string | null;
        against_type: string | null;
        sla_due_at: Date;
        created_at: Date;
      }[]
    >(
      `
      SELECT c.id AS complaint_id, c.complaint_number, c.order_id, o.order_number,
             c.category, c.severity, c.title,
             fu.full_name AS filed_by_name, fu.user_type::text AS filed_by_type,
             au.full_name AS against_name, au.user_type::text AS against_type,
             c.sla_due_at, c.created_at
      FROM complaints c
      LEFT JOIN orders o ON o.id = c.order_id
      LEFT JOIN users fu ON fu.id = c.filed_by_user_id
      LEFT JOIN users au ON au.id = c.against_user_id
      -- جدول complaints مالهوش عمود deleted_at (مفيش soft delete للشكاوى — السجل دايم عن قصد).
      WHERE c.resolved_at IS NULL
        AND c.created_at >= now() - ($1 || ' days')::interval
      ORDER BY c.sla_due_at ASC
      LIMIT $2
      `,
      [String(sinceDays), REVIEW_LIST_LIMIT],
    );

    const now = Date.now();
    return rows.map((r) => ({
      complaintId: r.complaint_id,
      complaintNumber: r.complaint_number,
      orderId: r.order_id,
      orderNumber: r.order_number,
      category: r.category,
      severity: r.severity,
      title: r.title,
      filedByName: r.filed_by_name,
      filedByType: r.filed_by_type,
      againstName: r.against_name,
      againstType: r.against_type,
      slaDueAt: new Date(r.sla_due_at).toISOString(),
      isOverdue: new Date(r.sla_due_at).getTime() < now,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }
}
