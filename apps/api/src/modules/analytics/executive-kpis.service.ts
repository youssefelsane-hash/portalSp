import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import {
  ASSIGNED_ORDER_STATUSES,
  CANCELLED_ORDER_STATUSES,
  NET_PARTICIPANT_EARNINGS_SQL,
  NET_PLATFORM_COMMISSION_SQL,
  orderWorkedMinutesSql,
  REPEAT_WINDOW_DAYS,
  SETTLED_PAYMENT_STATUSES,
} from './metric-definitions';

/**
 * قيمة مقياس واحد. `value` بيبقى `null` لما المقياس **مالوش معنى** في الفترة دي (مقام صفر،
 * أو بيانات ناقصة زي إنفاق تسويق مش مسجّل) — **مش صفر**. الفرق ده هو الفرق بين «مفيش
 * إلغاءات» و«مفيش طلبات أصلاً»، وبين «اكتساب العميل ببلاش» و«ما دخلناش الإنفاق».
 */
export interface KpiValue {
  key: string;
  value: number | null;
  unit: 'count' | 'cents' | 'percent' | 'seconds';
  /** المقام اللي النسبة اتحسبت عليه — من غيره «٥٠٪» على طلبين معناها غير «٥٠٪» على ألفين. */
  sample_size: number | null;
  /** ليه القيمة `null`؟ بيتعرض للأدمن بدل رقم كاذب. */
  unavailable_reason?: string;
}

export interface ExecutiveKpis {
  from: string;
  to: string;
  kpis: KpiValue[];
}

const NO_ORDERS = 'مفيش طلبات في الفترة دي';

@Injectable()
export class ExecutiveKpisService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
  ) {}

  /**
   * لوحة قيادة الشركة (ADR-0081 §1/§2).
   *
   * كل رقم هنا **بيتحسب من الجداول التشغيلية وقت الطلب**، مفيش عدّاد مخزّن ولا جدول تجميع.
   * السبب مش نظري: المشروع عنده تلات بَقّات موثّقة لعدّادات اتجمّدت على أصفار لما حد نسى
   * يزوّدها في مسار جديد. رقم غلط في لوحة الإدارة أخطر من مفيش رقم.
   *
   * **الأساس الزمني بيختلف حسب السؤال، وده مقصود:**
   * - «كام شغلانة خلصت؟» → تاريخ الاكتمال (`work_completed_at`).
   * - «فلوس إيه دخلت؟» → تاريخ الدفع (`paid_at`).
   * - «كام طلب اتعمل؟» → تاريخ الطلب (`placed_at`).
   * استخدام أساس واحد لكل حاجة كان هيخلّي إيراد الشهر ده منسوب لطلبات الشهر اللي فات.
   */
  async executiveKpis(from: Date, to: Date): Promise<ExecutiveKpis> {
    const [volume, money, funnelOps, quality, supply, cac] = await Promise.all([
      this.volumeKpis(from, to),
      this.moneyKpis(from, to),
      this.operationsKpis(from, to),
      this.qualityKpis(from, to),
      this.supplyKpis(from, to),
      this.customerAcquisitionCost(from, to),
    ]);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      kpis: [...volume, ...money, ...funnelOps, ...quality, ...supply, cac],
    };
  }

  /** «كام شغلانة خلصت فعلاً؟» — بتاريخ الاكتمال مش بتاريخ الطلب. */
  private async volumeKpis(from: Date, to: Date): Promise<KpiValue[]> {
    const [row] = await this.dataSource.query<{ completed: string; placed: string; repeat_customers: string; active_customers: string }[]>(
      `SELECT
         (SELECT COUNT(*) FROM orders
           WHERE deleted_at IS NULL AND order_status = 'completed'
             AND work_completed_at >= $1 AND work_completed_at < $2) AS completed,
         (SELECT COUNT(*) FROM orders
           WHERE deleted_at IS NULL AND placed_at >= $1 AND placed_at < $2) AS placed,
         -- العميل «راجع» لو عمل طلب تاني خلال نافذة التكرار من طلبه اللي قبله. بنقيس على
         -- العملاء اللي عملوا طلب في الفترة دي، مش على كل العملاء من أول التاريخ.
         (SELECT COUNT(*) FROM (
            SELECT o.customer_id
              FROM orders o
             WHERE o.deleted_at IS NULL AND o.placed_at >= $1 AND o.placed_at < $2
               AND EXISTS (
                 SELECT 1 FROM orders prev
                  WHERE prev.customer_id = o.customer_id AND prev.deleted_at IS NULL
                    AND prev.id <> o.id
                    AND prev.placed_at < o.placed_at
                    AND prev.placed_at >= o.placed_at - ($3 || ' days')::interval)
             GROUP BY o.customer_id) repeat_c) AS repeat_customers,
         (SELECT COUNT(DISTINCT customer_id) FROM orders
           WHERE deleted_at IS NULL AND placed_at >= $1 AND placed_at < $2) AS active_customers`,
      [from, to, String(REPEAT_WINDOW_DAYS)],
    );

    const activeCustomers = Number(row?.active_customers ?? 0);
    return [
      { key: 'completed_orders', value: Number(row?.completed ?? 0), unit: 'count', sample_size: null },
      { key: 'placed_orders', value: Number(row?.placed ?? 0), unit: 'count', sample_size: null },
      this.ratio('repeat_rate', Number(row?.repeat_customers ?? 0), activeCustomers, 'مفيش عملاء عملوا طلبات في الفترة دي'),
    ];
  }

  /**
   * GMV مش الإيراد — وده أكتر التباس في لوحات القيادة. GMV = قيمة الشغل اللي عدّى على
   * المنصة. الإيراد = دخلنا إحنا (العمولة بعد طرح ما اترجع منها في الاستردادات).
   *
   * هامش المساهمة = الإيراد − التكاليف المباشرة اللي المنصة بتتحملها على نفس الطلبات:
   * الخصومات (`0287`: الترويج تكلفة منصة مش خصم من الفني) + تعويضات الشكاوى.
   */
  private async moneyKpis(from: Date, to: Date): Promise<KpiValue[]> {
    const [row] = await this.dataSource.query<
      { gmv: string; revenue: string; technician_earnings: string; discounts: string; refunds: string; compensations: string }[]
    >(
      `SELECT
         COALESCE(SUM(o.total_amount_cents), 0) AS gmv,
         COALESCE(SUM(${NET_PLATFORM_COMMISSION_SQL}), 0) AS revenue,
         COALESCE(SUM(${NET_PARTICIPANT_EARNINGS_SQL}), 0) AS technician_earnings,
         COALESCE(SUM(o.discount_amount_cents), 0) AS discounts,
         COALESCE((SELECT SUM(r.amount_cents) FROM refunds r
                    JOIN orders ro ON ro.id = r.order_id
                   WHERE r.refund_status = 'completed'
                     AND r.completed_at >= $1 AND r.completed_at < $2), 0) AS refunds,
         COALESCE((SELECT SUM(c.compensation_cents) FROM complaints c
                    JOIN orders co ON co.id = c.order_id
                   WHERE c.compensation_cents IS NOT NULL
                     AND c.resolved_at >= $1 AND c.resolved_at < $2), 0) AS compensations
       FROM orders o
       WHERE o.deleted_at IS NULL
         AND o.payment_status = ANY($3::order_payment_status[])
         AND o.paid_at >= $1 AND o.paid_at < $2`,
      [from, to, [...SETTLED_PAYMENT_STATUSES]],
    );

    const gmv = Number(row?.gmv ?? 0);
    const revenue = Number(row?.revenue ?? 0);
    const discounts = Number(row?.discounts ?? 0);
    const compensations = Number(row?.compensations ?? 0);
    const refunds = Number(row?.refunds ?? 0);

    return [
      { key: 'gmv_cents', value: gmv, unit: 'cents', sample_size: null },
      { key: 'revenue_cents', value: revenue, unit: 'cents', sample_size: null },
      { key: 'technician_earnings_cents', value: Number(row?.technician_earnings ?? 0), unit: 'cents', sample_size: null },
      { key: 'discounts_cents', value: discounts, unit: 'cents', sample_size: null },
      { key: 'refunds_cents', value: refunds, unit: 'cents', sample_size: null },
      // الخصم والتعويض بيتطرحوا هنا؛ الاسترداد اتطرح بالفعل جوّه صافي العمولة، وطرحه تاني
      // كان هيحسبه مرتين.
      { key: 'contribution_margin_cents', value: revenue - discounts - compensations, unit: 'cents', sample_size: null },
      this.ratio('refund_rate', refunds, gmv, 'مفيش مبيعات مدفوعة في الفترة دي'),
    ];
  }

  /** المطابقة: بنلاقي فني ولا لأ، وبنلاقيه في قد إيه. */
  private async operationsKpis(from: Date, to: Date): Promise<KpiValue[]> {
    const [row] = await this.dataSource.query<
      { placed: string; matched: string; cancelled: string; avg_match_seconds: string | null; median_match_seconds: string | null }[]
    >(
      `SELECT
         COUNT(*) AS placed,
         COUNT(*) FILTER (WHERE order_status = ANY($3::order_status[])) AS matched,
         COUNT(*) FILTER (WHERE order_status = ANY($4::order_status[])) AS cancelled,
         AVG(EXTRACT(EPOCH FROM (assigned_at - placed_at)))
           FILTER (WHERE assigned_at IS NOT NULL) AS avg_match_seconds,
         -- الوسيط مش المتوسط هو الرقم اللي بيتقال للإدارة: طلب واحد استنى ٦ ساعات بيرفع
         -- المتوسط لوحده ويخفي إن أغلب الطلبات اتطابقت في دقايق.
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (assigned_at - placed_at)))
           FILTER (WHERE assigned_at IS NOT NULL) AS median_match_seconds
       FROM orders
       WHERE deleted_at IS NULL AND placed_at >= $1 AND placed_at < $2`,
      [from, to, [...ASSIGNED_ORDER_STATUSES], [...CANCELLED_ORDER_STATUSES]],
    );

    const placed = Number(row?.placed ?? 0);
    return [
      this.ratio('match_rate', Number(row?.matched ?? 0), placed, NO_ORDERS),
      this.ratio('cancellation_rate', Number(row?.cancelled ?? 0), placed, NO_ORDERS),
      {
        key: 'median_time_to_match_seconds',
        value: row?.median_match_seconds !== null && row?.median_match_seconds !== undefined ? Math.round(Number(row.median_match_seconds)) : null,
        unit: 'seconds',
        sample_size: placed,
        ...(row?.median_match_seconds === null ? { unavailable_reason: 'مفيش طلب اتطابق في الفترة دي' } : {}),
      },
      {
        key: 'avg_time_to_match_seconds',
        value: row?.avg_match_seconds !== null && row?.avg_match_seconds !== undefined ? Math.round(Number(row.avg_match_seconds)) : null,
        unit: 'seconds',
        sample_size: placed,
        ...(row?.avg_match_seconds === null ? { unavailable_reason: 'مفيش طلب اتطابق في الفترة دي' } : {}),
      },
    ];
  }

  /** الجودة: الانضباط، الشكاوى، وإعادة الشغل. */
  private async qualityKpis(from: Date, to: Date): Promise<KpiValue[]> {
    const [row] = await this.dataSource.query<
      { completed: string; on_time: string; on_time_known: string; complaints: string; rework: string }[]
    >(
      `WITH completed AS (
         SELECT id, was_on_time
           FROM orders
          WHERE deleted_at IS NULL AND order_status = 'completed'
            AND work_completed_at >= $1 AND work_completed_at < $2
       )
       SELECT (SELECT COUNT(*) FROM completed) AS completed,
              (SELECT COUNT(*) FROM completed WHERE was_on_time IS TRUE) AS on_time,
              -- الطلبات اللي الانضباط فيها **معروف** أصلاً. الطلب اللي was_on_time فيه NULL
              -- (مفيش ميعاد محدد، أو ما اتسجّلش وصول) مايتحسبش «متأخر» — ده كان هيدّي نسبة
              -- انضباط كاذبة أقل من الحقيقة.
              (SELECT COUNT(*) FROM completed WHERE was_on_time IS NOT NULL) AS on_time_known,
              (SELECT COUNT(*) FROM complaints c
                WHERE c.order_id IN (SELECT id FROM completed)) AS complaints,
              -- إعادة الشغل = طلب اتولد كزيارة إعادة لطلب قديم (parent_order_id) أو طلب
              -- اتفتح تاني. الاتنين معناهم إن الشغل الأصلي ما خلصش صح.
              (SELECT COUNT(*) FROM orders r
                WHERE r.deleted_at IS NULL
                  AND (r.parent_order_id IN (SELECT id FROM completed) OR (r.is_reopened AND r.id IN (SELECT id FROM completed)))) AS rework`,
      [from, to],
    );

    const completed = Number(row?.completed ?? 0);
    const onTimeKnown = Number(row?.on_time_known ?? 0);
    return [
      this.ratio('on_time_rate', Number(row?.on_time ?? 0), onTimeKnown, 'مفيش شغل مكتمل بانضباط معروف في الفترة دي'),
      this.ratio('complaint_rate', Number(row?.complaints ?? 0), completed, 'مفيش شغل مكتمل في الفترة دي'),
      this.ratio('rework_rate', Number(row?.rework ?? 0), completed, 'مفيش شغل مكتمل في الفترة دي'),
    ];
  }

  /**
   * العرض: هل الفنيين مشغولين؟ وهل بيستمروا معانا؟
   *
   * الاستغلال = دقايق الشغل المحجوزة ÷ (الفنيين المعتمدين × القدرة اليومية × عدد الأيام).
   * القدرة اليومية بتتقرا من نفس الإعداد اللي محرك المطابقة بيستخدمه
   * (`matching.daily_capacity_minutes`) — مش رقم تاني مكتوب هنا، وإلا اللوحة كانت هتقول
   * الفني فاضي والمحرك يقول مليان.
   */
  private async supplyKpis(from: Date, to: Date): Promise<KpiValue[]> {
    const capacityMinutes = await this.settings.getNumber('matching.daily_capacity_minutes', 720);
    const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (24 * 3600 * 1000)));

    const [row] = await this.dataSource.query<
      { booked_minutes: string; approved_technicians: string; active_before: string; retained: string }[]
    >(
      `SELECT
         COALESCE((SELECT SUM(${orderWorkedMinutesSql('o')})
                     FROM orders o
                    WHERE o.deleted_at IS NULL AND o.technician_id IS NOT NULL
                      AND o.order_status = ANY($3::order_status[])
                      AND o.placed_at >= $1 AND o.placed_at < $2), 0) AS booked_minutes,
         (SELECT COUNT(*) FROM technician_profiles
           WHERE deleted_at IS NULL AND verification_status = 'approved') AS approved_technicians,
         -- الاستبقاء: الفنيين اللي اشتغلوا في الفترة **اللي قبل** دي بنفس طولها، وكام واحد
         -- منهم لسه شغّال في الفترة الحالية. المقارنة بنفس الطول ضرورية — أسبوع مقابل شهر
         -- بيدّي رقم بلا معنى.
         (SELECT COUNT(DISTINCT technician_id) FROM orders
           WHERE deleted_at IS NULL AND technician_id IS NOT NULL
             AND placed_at >= $1 - ($2 - $1) AND placed_at < $1) AS active_before,
         (SELECT COUNT(DISTINCT technician_id) FROM orders cur
           WHERE cur.deleted_at IS NULL AND cur.technician_id IS NOT NULL
             AND cur.placed_at >= $1 AND cur.placed_at < $2
             AND EXISTS (SELECT 1 FROM orders prev
                          WHERE prev.deleted_at IS NULL AND prev.technician_id = cur.technician_id
                            AND prev.placed_at >= $1 - ($2 - $1) AND prev.placed_at < $1)) AS retained`,
      [from, to, [...ASSIGNED_ORDER_STATUSES]],
    );

    const approved = Number(row?.approved_technicians ?? 0);
    const capacityTotal = approved * capacityMinutes * days;
    const activeBefore = Number(row?.active_before ?? 0);

    return [
      this.ratio('technician_utilization', Number(row?.booked_minutes ?? 0), capacityTotal, 'مفيش فنيين معتمدين'),
      this.ratio('technician_retention', Number(row?.retained ?? 0), activeBefore, 'مفيش فنيين اشتغلوا في الفترة اللي قبل دي'),
      { key: 'approved_technicians', value: approved, unit: 'count', sample_size: null },
    ];
  }

  /**
   * CAC = إنفاق التسويق في الفترة ÷ العملاء الجداد اللي عملوا **أول** طلب فيها.
   *
   * بيرجّع `null` صريح لو مفيش إنفاق مسجّل — الصفر هنا كذب بيقول اكتساب العميل ببلاش
   * (ADR-0081 §6). الإنفاق مسجّل بالشهر، فالفترة اللي بتقطع نص شهر بتاخد الشهر كامل
   * وده بيتقال في `unavailable_reason` بدل ما يعدّي بصمت.
   */
  private async customerAcquisitionCost(from: Date, to: Date): Promise<KpiValue> {
    const [row] = await this.dataSource.query<{ spend: string | null; new_customers: string }[]>(
      `SELECT
         (SELECT SUM(amount_cents) FROM marketing_spend
           WHERE deleted_at IS NULL
             AND month >= date_trunc('month', $1::timestamptz)
             AND month <= date_trunc('month', $2::timestamptz)) AS spend,
         (SELECT COUNT(*) FROM (
            SELECT o.customer_id, MIN(o.placed_at) AS first_order
              FROM orders o
             WHERE o.deleted_at IS NULL
             GROUP BY o.customer_id
            HAVING MIN(o.placed_at) >= $1 AND MIN(o.placed_at) < $2) first_orders) AS new_customers`,
      [from, to],
    );

    const spend = row?.spend === null || row?.spend === undefined ? null : Number(row.spend);
    const newCustomers = Number(row?.new_customers ?? 0);

    if (spend === null) {
      return {
        key: 'cac_cents',
        value: null,
        unit: 'cents',
        sample_size: newCustomers,
        unavailable_reason: 'مفيش إنفاق تسويق مسجّل للشهور دي — سجّله عشان الرقم يبقى حقيقي',
      };
    }
    if (newCustomers === 0) {
      return {
        key: 'cac_cents',
        value: null,
        unit: 'cents',
        sample_size: 0,
        unavailable_reason: 'مفيش عملاء جداد في الفترة دي',
      };
    }
    return { key: 'cac_cents', value: Math.round(spend / newCustomers), unit: 'cents', sample_size: newCustomers };
  }

  /** نسبة مئوية بمقام محروس — المقام صفر بيرجّع `null` بسبب مكتوب، مش صفر ولا NaN. */
  private ratio(key: string, numerator: number, denominator: number, emptyReason: string): KpiValue {
    if (denominator <= 0) {
      return { key, value: null, unit: 'percent', sample_size: 0, unavailable_reason: emptyReason };
    }
    return {
      key,
      value: Number(((numerator / denominator) * 100).toFixed(2)),
      unit: 'percent',
      sample_size: denominator,
    };
  }
}
