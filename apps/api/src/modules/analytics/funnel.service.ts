import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DERIVED_FUNNEL_STAGES, FUNNEL_STAGES } from './entities/booking-funnel-event.entity';
import { ASSIGNED_ORDER_STATUSES } from './metric-definitions';

export interface FunnelStageRow {
  stage: string;
  /** عدد المحاولات اللي وصلت للمرحلة دي. */
  count: number;
  /** محاولات المرحلة دي اللي **فشلت** — المنتج منع العميل يكمّل، مش إنه غيّر رأيه. */
  failed_count: number;
  /** النسبة من أول مرحلة فيها بيانات (نقطة البداية الفعلية للفنل). */
  pct_of_entry: number | null;
  /** اللي اتفقدوا بين المرحلة اللي قبلها ودي. */
  dropped_from_previous: number | null;
  drop_rate_from_previous: number | null;
  /** `server` مضمون، `client` بيعتمد على التطبيق، `derived` محسوب من حالة الطلب. */
  trust: 'server' | 'client' | 'derived' | 'mixed';
}

export interface FunnelFailureRow {
  stage: string;
  failure_reason: string;
  count: number;
}

export interface FunnelReport {
  from: string;
  to: string;
  stages: FunnelStageRow[];
  top_failures: FunnelFailureRow[];
  /** أسوأ تسرّب — الرد المباشر على «الفلو بيتكسر فين؟». */
  worst_drop: { stage: string; dropped: number; drop_rate: number } | null;
  sessions_tracked: number;
  sessions_untracked: number;
}

/**
 * الحالات اللي بتعتبر «الفني وصل» — الحالة نفسها أو أي حالة بعدها، لأن الطلب ممكن يكون عدّى
 * منها بسرعة ومايتسجّلش صف منفصل لكل خطوة.
 */
const ARRIVED_STATUSES = ['technician_arrived', 'in_progress', 'work_completed', 'awaiting_payment', 'completed'];

@Injectable()
export class FunnelService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * فنل رحلة الحجز الكامل (ADR-0081 §3).
   *
   * **وحدة العد بتختلف بين نصّين الفنل عن قصد، وده مذكور في الرد نفسه:**
   * - المراحل قبل الطلب بتتعد بـ**المحاولة** (`funnel_session_id`) — العميل الواحد ممكن يحاول
   *   مرتين في يوم، ودي محاولتين حقيقيتين.
   * - المراحل بعد الطلب بتتعد بـ**الطلب**، ومصدرها `order_status_history` مش الجدول.
   *
   * الاتنين بيتقابلوا عند `order_placed`: نفس الرقم بالظبط هو نهاية النص الأول وبداية التاني،
   * فالتسرّب بينهم يفضل قابل للجمع. لو اتعدّوا بوحدتين مختلفتين هنا، كل النسب اللي بعده تبقى
   * كذب مرتب.
   */
  async bookingFunnel(from: Date, to: Date): Promise<FunnelReport> {
    const recorded = await this.dataSource.query<
      { stage: string; count: string; failed_count: string; sources: string[] }[]
    >(
      // `order_id` أول واحد في `COALESCE` عن قصد: `order_placed` لازم تتعد **بالطلب** عشان
      // نفس الرقم بالظبط يبقى نهاية النص الأول وبداية النص التاني المشتق من
      // `order_status_history` (الجملة اللي فوق بتوعد بده). جلسة واحدة عملت طلبين كانت بتتعد
      // «١» هنا و«٢» في المشتق، فالمراحل بعد الطلب تطلع أكبر من الطلب نفسه — فنل صاعد،
      // مستحيل منطقيًا. باقي المراحل `order_id` فيها NULL فبتقع على الجلسة زي ما كانت.
      `SELECT stage,
              COUNT(DISTINCT COALESCE(order_id::text, funnel_session_id::text, id::text))
                FILTER (WHERE outcome = 'success') AS count,
              COUNT(*) FILTER (WHERE outcome = 'failed') AS failed_count,
              array_agg(DISTINCT source) AS sources
         FROM booking_funnel_events
        WHERE occurred_at >= $1 AND occurred_at < $2
        GROUP BY stage`,
      [from, to],
    );
    const recordedByStage = new Map(recorded.map((r) => [r.stage, r]));

    // المراحل المشتقة: نفس مجموعة الطلبات اللي اتولدت في الفترة (cohort واحد)، وبنسأل مين
    // منهم وصل لكل حالة. `order_status_history` هي مصدر الحقيقة — مش عمود محفوظ على الطلب.
    const [derived] = await this.dataSource.query<
      { placed: string; assigned: string; arrived: string; completed: string }[]
    >(
      `WITH placed AS (
         SELECT DISTINCT order_id
           FROM booking_funnel_events
          WHERE stage = 'order_placed' AND outcome = 'success'
            AND order_id IS NOT NULL
            AND occurred_at >= $1 AND occurred_at < $2
       )
       SELECT (SELECT COUNT(*) FROM placed) AS placed,
              (SELECT COUNT(*) FROM placed p WHERE EXISTS (
                 SELECT 1 FROM order_status_history h
                  WHERE h.order_id = p.order_id AND h.new_status = ANY($3::order_status[]))) AS assigned,
              (SELECT COUNT(*) FROM placed p WHERE EXISTS (
                 SELECT 1 FROM order_status_history h
                  WHERE h.order_id = p.order_id AND h.new_status = ANY($4::order_status[]))) AS arrived,
              (SELECT COUNT(*) FROM placed p WHERE EXISTS (
                 SELECT 1 FROM order_status_history h
                  WHERE h.order_id = p.order_id AND h.new_status = 'completed')) AS completed`,
      [from, to, [...ASSIGNED_ORDER_STATUSES], ARRIVED_STATUSES],
    );

    const derivedCounts: Record<string, number> = {
      technician_assigned: Number(derived?.assigned ?? 0),
      technician_arrived: Number(derived?.arrived ?? 0),
      order_completed: Number(derived?.completed ?? 0),
    };

    const rows: FunnelStageRow[] = [];
    for (const stage of FUNNEL_STAGES) {
      const row = recordedByStage.get(stage);
      const sources = row?.sources ?? [];
      rows.push({
        stage,
        count: Number(row?.count ?? 0),
        failed_count: Number(row?.failed_count ?? 0),
        pct_of_entry: null,
        dropped_from_previous: null,
        drop_rate_from_previous: null,
        trust: sources.length === 0 ? 'server' : sources.length > 1 ? 'mixed' : (sources[0] as 'server' | 'client'),
      });
    }
    for (const stage of DERIVED_FUNNEL_STAGES) {
      rows.push({
        stage,
        count: derivedCounts[stage],
        failed_count: 0,
        pct_of_entry: null,
        dropped_from_previous: null,
        drop_rate_from_previous: null,
        trust: 'derived',
      });
    }

    // نقطة الدخول = أول مرحلة فيها أي بيانات. من غير كده، مرحلة أولى فاضية (كلاينت لسه
    // مابيبعتش `service_viewed`) كانت هتخلّي كل النسب صفر والتقرير كله بلا معنى.
    const entry = rows.find((r) => r.count > 0);
    const entryCount = entry?.count ?? 0;
    let previous: FunnelStageRow | null = null;
    for (const row of rows) {
      if (entryCount > 0 && (entry === row || previous !== null)) {
        row.pct_of_entry = Number(((row.count / entryCount) * 100).toFixed(2));
      }
      if (previous && previous.count > 0) {
        const dropped = Math.max(0, previous.count - row.count);
        row.dropped_from_previous = dropped;
        row.drop_rate_from_previous = Number(((dropped / previous.count) * 100).toFixed(2));
      }
      if (row.count > 0 || previous !== null) previous = row;
    }

    const failures = await this.dataSource.query<{ stage: string; failure_reason: string; count: string }[]>(
      `SELECT stage, failure_reason, COUNT(*) AS count
         FROM booking_funnel_events
        WHERE outcome = 'failed' AND occurred_at >= $1 AND occurred_at < $2
        GROUP BY stage, failure_reason
        ORDER BY COUNT(*) DESC, stage ASC
        LIMIT 20`,
      [from, to],
    );

    const [coverage] = await this.dataSource.query<{ tracked: string; untracked: string }[]>(
      `SELECT COUNT(DISTINCT funnel_session_id) AS tracked,
              COUNT(*) FILTER (WHERE funnel_session_id IS NULL) AS untracked
         FROM booking_funnel_events
        WHERE occurred_at >= $1 AND occurred_at < $2`,
      [from, to],
    );

    const withDrop = rows.filter((r) => r.dropped_from_previous !== null && r.dropped_from_previous > 0);
    const worst = withDrop.sort((a, b) => (b.dropped_from_previous ?? 0) - (a.dropped_from_previous ?? 0))[0];

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      stages: rows,
      top_failures: failures.map((f) => ({
        stage: f.stage,
        failure_reason: f.failure_reason,
        count: Number(f.count),
      })),
      worst_drop: worst
        ? {
            stage: worst.stage,
            dropped: worst.dropped_from_previous ?? 0,
            drop_rate: worst.drop_rate_from_previous ?? 0,
          }
        : null,
      sessions_tracked: Number(coverage?.tracked ?? 0),
      sessions_untracked: Number(coverage?.untracked ?? 0),
    };
  }

  /**
   * نفس الفنل مقسّم بالخدمة — الرد على «أنهي صفحة/خدمة بالذات بتخسر ناس؟». بيرجّع الخدمات
   * اللي فيها أعلى تسرّب بين بداية الحجز وإنشاء الطلب.
   */
  async funnelByService(from: Date, to: Date, limit = 20): Promise<
    { service_id: string; name_ar: string; started: number; placed: number; conversion_pct: number; failed: number }[]
  > {
    const rows = await this.dataSource.query<
      { service_id: string; name_ar: string; started: string; placed: string; failed: string }[]
    >(
      `SELECT e.service_id,
              s.name_ar,
              COUNT(DISTINCT COALESCE(e.funnel_session_id::text, e.id::text))
                FILTER (WHERE e.stage IN ('booking_started', 'price_previewed') AND e.outcome = 'success') AS started,
              COUNT(DISTINCT e.order_id) FILTER (WHERE e.stage = 'order_placed' AND e.outcome = 'success') AS placed,
              COUNT(*) FILTER (WHERE e.outcome = 'failed') AS failed
         FROM booking_funnel_events e
         JOIN services s ON s.id = e.service_id
        WHERE e.occurred_at >= $1 AND e.occurred_at < $2 AND e.service_id IS NOT NULL
        GROUP BY e.service_id, s.name_ar
       HAVING COUNT(DISTINCT COALESCE(e.funnel_session_id::text, e.id::text))
                FILTER (WHERE e.stage IN ('booking_started', 'price_previewed') AND e.outcome = 'success') > 0
        ORDER BY started DESC
        LIMIT $3`,
      [from, to, limit],
    );

    return rows.map((r) => {
      const started = Number(r.started);
      const placed = Number(r.placed);
      return {
        service_id: r.service_id,
        name_ar: r.name_ar,
        started,
        placed,
        conversion_pct: started > 0 ? Number(((placed / started) * 100).toFixed(2)) : 0,
        failed: Number(r.failed),
      };
    });
  }
}
