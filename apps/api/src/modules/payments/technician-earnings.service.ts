import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';

/** أقصى عدد شهور سابقة يرجّعها `listAvailableMonths` — سنتين كفاية لأي مراجعة عملية. */
const MAX_HISTORY_MONTHS = 24;

/**
 * سطر شغلانة واحدة في كشف الشهر. كل الأرقام قروش.
 *
 * الحقول مصمّمة عشان الفني يفهم الرقم **من غير ما حد يشرحله** (طلب مالك صريح): بيشوف السعر
 * الأصلي، خصم العميل، اللي العميل دفعه، ومستحقه — ويشوف صراحةً إن الخصم ما اتحمّلش عليه.
 */
export interface TechnicianStatementJob {
  orderId: string;
  orderNumber: string;
  serviceNameAr: string | null;
  closedAt: string;
  /** سعر الخدمة قبل أي خصم — الأساس اللي مستحق الفني بيتحسب منه (ADR-0038). */
  originalPriceCents: number;
  /** الزيادات المعتمدة أثناء الشغل (بنود إضافية) — جزء من الشغل، فجزء من مستحقه. */
  additionalWorkCents: number;
  /** فرق مستوى الفني (§60.3) — بيزوّد مستحقه هو. */
  levelPremiumCents: number;
  /** خصم العميل (كوبون/عمارة/حملة). */
  customerDiscountCents: number;
  /** اللي العميل دفعه فعلاً بعد الخصم. */
  customerPaidCents: number;
  /** الوعاء اللي العمولة اتطبّقت عليه. */
  commissionableBaseCents: number;
  commissionRatePercentage: number;
  platformCommissionCents: number;
  /** **دايمًا صفر** (ADR-0038) — بيتعرض صراحةً عشان يبقى واضح مين دفع الخصم. */
  discountBorneByTechnicianCents: number;
  /** صافي مستحق الفني عن الشغلانة دي. */
  netTechnicianDueCents: number;
}

export interface TechnicianMonthlyStatement {
  /** `YYYY-MM` بتوقيت القاهرة. */
  month: string;
  monthStart: string;
  monthEnd: string;
  /** true للشهر اللي إحنا فيه — يعني الرقم "حتى هذه اللحظة" ولسه ممكن يزيد. */
  isCurrentMonth: boolean;
  jobsCount: number;
  totals: {
    originalPriceCents: number;
    additionalWorkCents: number;
    levelPremiumCents: number;
    customerDiscountCents: number;
    customerPaidCents: number;
    platformCommissionCents: number;
    discountBorneByTechnicianCents: number;
    /** **إجمالي مستحقات الفني للشهر**. */
    netTechnicianDueCents: number;
  };
  jobs: TechnicianStatementJob[];
}

/**
 * كشف مستحقات الفني الشهري (ADR-0038، docs/08 §61.1).
 *
 * **read model خالص** — صفر جداول جديدة، صفر كتابة، صفر مهمة شهرية. كل البيانات موجودة أصلاً
 * كـsnapshot على الطلب من ساعة التسوية، فجدول تجميع شهري كان هيبقى نسخة تانية من نفس الحقيقة
 * (وعرضة لعدم الاتساق لو طلب اتعدّل بأثر رجعي).
 *
 * **الشهر "بيقفل" بحدود التاريخ مش بحالة**: مفيش عمود `is_closed` ولا إجراء إقفال — الشهر
 * السابق مقفول لأن مفيش طلبات جديدة ممكن `closed_at` بتاعها يقع فيه.
 */
@Injectable()
export class TechnicianEarningsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** `YYYY-MM` بتوقيت القاهرة. بيرمي على أي شكل تاني بدل ما يبني SQL بقيمة مش متحقّق منها. */
  private parseMonth(month: string): { year: number; monthNumber: number } {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match) {
      throw new ApiException(ErrorCode.VAL_001, 'صيغة الشهر لازم تكون YYYY-MM', HttpStatus.BAD_REQUEST);
    }
    const year = Number(match[1]);
    const monthNumber = Number(match[2]);
    if (monthNumber < 1 || monthNumber > 12) {
      throw new ApiException(ErrorCode.VAL_001, 'رقم الشهر لازم يكون بين 01 و12', HttpStatus.BAD_REQUEST);
    }
    return { year, monthNumber };
  }

  /** الشهر الحالي بتوقيت القاهرة — مش UTC. طلب اتقفل 1 صباحًا يوم 1 لازم يقع في الشهر الجديد. */
  static currentMonthCairo(now: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(now);
    const year = parts.find((p) => p.type === 'year')!.value;
    const month = parts.find((p) => p.type === 'month')!.value;
    return `${year}-${month}`;
  }

  /**
   * الشهور اللي فيها شغل مقفول فعلاً للفني ده، من الأحدث للأقدم. الشهر الحالي بيتحط دايمًا
   * حتى لو لسه فاضي — الفني لازم يشوف "الشهر ده: صفر" مش قايمة فاضية تخليه يفتكر إن فيه عطل.
   */
  async listAvailableMonths(technicianProfileId: string): Promise<string[]> {
    const rows = await this.dataSource.query<{ month: string }[]>(
      `SELECT DISTINCT to_char((o.closed_at AT TIME ZONE 'Africa/Cairo'), 'YYYY-MM') AS month
       FROM orders o
       WHERE o.technician_id = $1 AND o.closed_at IS NOT NULL AND o.deleted_at IS NULL
       ORDER BY month DESC
       LIMIT $2`,
      [technicianProfileId, MAX_HISTORY_MONTHS],
    );
    const months = rows.map((r) => r.month);
    const current = TechnicianEarningsService.currentMonthCairo();
    return months.includes(current) ? months : [current, ...months];
  }

  async getMonthlyStatement(technicianProfileId: string, month: string): Promise<TechnicianMonthlyStatement> {
    this.parseMonth(month);
    const currentMonth = TechnicianEarningsService.currentMonthCairo();

    // ملحوظة على الحدود: بنقارن على `to_char(...)` بدل BETWEEN بتاريخين عشان نتجنّب أخطاء
    // الحدود عند آخر يوم في الشهر ووقت تغيير التوقيت الصيفي. الفهرس على technician_id بيقلّل
    // الصفوف المفحوصة لطلبات الفني ده بس، فالتحويل النصي مش على الجدول كله.
    const jobs = await this.dataSource.query<
      {
        order_id: string;
        order_number: string;
        service_name_ar: string | null;
        closed_at: Date;
        total_amount_cents: number;
        discount_amount_cents: number;
        level_premium_cents: number;
        commissionable_base_cents: number | null;
        commission_rate_applied: string | null;
        platform_commission_cents: number;
        technician_earning_cents: number;
        additional_work_cents: string;
      }[]
    >(
      `SELECT o.id AS order_id, o.order_number, s.name_ar AS service_name_ar, o.closed_at,
              o.total_amount_cents, o.discount_amount_cents, o.level_premium_cents,
              o.commissionable_base_cents, o.commission_rate_applied,
              o.platform_commission_cents, o.technician_earning_cents,
              COALESCE((
                SELECT SUM(oi.total_price_cents) FROM order_items oi
                WHERE oi.order_id = o.id
                  AND oi.item_type IN ('spare_part','extra_labor')
                  AND oi.is_customer_approved = true
              ), 0)::text AS additional_work_cents
       FROM orders o
       LEFT JOIN services s ON s.id = o.service_id
       WHERE o.technician_id = $1
         AND o.closed_at IS NOT NULL
         AND o.deleted_at IS NULL
         AND to_char((o.closed_at AT TIME ZONE 'Africa/Cairo'), 'YYYY-MM') = $2
       ORDER BY o.closed_at ASC`,
      [technicianProfileId, month],
    );

    const mapped: TechnicianStatementJob[] = jobs.map((row) => {
      const customerPaidCents = Number(row.total_amount_cents);
      const customerDiscountCents = Number(row.discount_amount_cents);
      const additionalWorkCents = Number(row.additional_work_cents);
      const levelPremiumCents = Number(row.level_premium_cents);
      return {
        orderId: row.order_id,
        orderNumber: row.order_number,
        serviceNameAr: row.service_name_ar,
        closedAt: row.closed_at.toISOString(),
        // السعر الأصلي = اللي العميل دفعه + الخصم اللي المنصة تحمّلته.
        originalPriceCents: customerPaidCents + customerDiscountCents,
        additionalWorkCents,
        levelPremiumCents,
        customerDiscountCents,
        customerPaidCents,
        commissionableBaseCents: Number(row.commissionable_base_cents ?? customerPaidCents),
        commissionRatePercentage: Number(row.commission_rate_applied ?? 0),
        platformCommissionCents: Number(row.platform_commission_cents),
        // ADR-0038 — دايمًا صفر. بيتعرض صراحةً مش بيتشال، عشان الفني يشوف بعينه إن الكوبون
        // ما اتخصمش منه.
        discountBorneByTechnicianCents: 0,
        netTechnicianDueCents: Number(row.technician_earning_cents),
      };
    });

    const sum = (pick: (job: TechnicianStatementJob) => number) => mapped.reduce((acc, job) => acc + pick(job), 0);

    return {
      month,
      monthStart: `${month}-01`,
      monthEnd: this.lastDayOf(month),
      isCurrentMonth: month === currentMonth,
      jobsCount: mapped.length,
      totals: {
        originalPriceCents: sum((j) => j.originalPriceCents),
        additionalWorkCents: sum((j) => j.additionalWorkCents),
        levelPremiumCents: sum((j) => j.levelPremiumCents),
        customerDiscountCents: sum((j) => j.customerDiscountCents),
        customerPaidCents: sum((j) => j.customerPaidCents),
        platformCommissionCents: sum((j) => j.platformCommissionCents),
        discountBorneByTechnicianCents: 0,
        netTechnicianDueCents: sum((j) => j.netTechnicianDueCents),
      },
      jobs: mapped,
    };
  }

  private lastDayOf(month: string): string {
    const { year, monthNumber } = this.parseMonth(month);
    // اليوم صفر من الشهر اللي بعده = آخر يوم في الشهر ده (بيتعامل مع فبراير والسنة الكبيسة صح).
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return `${month}-${String(lastDay).padStart(2, '0')}`;
  }
}
