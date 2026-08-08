import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, MoreThanOrEqual, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Payout, PayoutStatus } from '../payments/entities/payout.entity';
import { Complaint, ComplaintStatus } from '../support/entities/complaint.entity';
import { Order, OrderPaymentStatus, OrderStatus } from '../orders/entities/order.entity';
import { Rating } from '../ratings/entities/rating.entity';
import { TechnicianProfile, TechnicianVerificationStatus } from '../technicians/entities/technician-profile.entity';
import { RevenueReportQueryDto } from './dto/revenue-report-query.dto';
import { TechniciansReportQueryDto, TechniciansReportSortBy } from './dto/technicians-report-query.dto';
import { ZonesReportQueryDto } from './dto/zones-report-query.dto';

const OPEN_COMPLAINT_STATUSES = [
  ComplaintStatus.OPEN,
  ComplaintStatus.UNDER_INVESTIGATION,
  ComplaintStatus.AWAITING_CUSTOMER,
  ComplaintStatus.AWAITING_TECHNICIAN,
  ComplaintStatus.ESCALATED,
];

const IN_VERIFICATION_STATUSES = [
  TechnicianVerificationStatus.PENDING,
  TechnicianVerificationStatus.DOCUMENTS_SUBMITTED,
  TechnicianVerificationStatus.UNDER_REVIEW,
  TechnicianVerificationStatus.INTERVIEW_SCHEDULED,
  TechnicianVerificationStatus.TEST_PASSED,
];

export interface DashboardStats {
  orders_today: { total: number; completed: number; active: number; cancelled: number };
  revenue_today_cents: number;
  platform_commission_today_cents: number;
  technicians: { approved: number; pending_verification: number; available_now: number };
  complaints_open: number;
  average_rating: number | null;
  users: { total: number; new_today: number; by_user_type: Record<string, number> };
  financial: { pending_payouts_count: number; pending_payouts_amount_cents: number };
}

export interface RevenuePeriodRow {
  period_start: string;
  orders_count: number;
  total_amount_cents: number;
  platform_commission_cents: number;
  technician_earnings_cents: number;
}

export interface ZoneReportRow {
  zone_id: string;
  name_ar: string;
  name_en: string;
  city_id: string;
  city_name_ar: string;
  is_active: boolean;
  surge_multiplier: string;
  orders_count: number;
  completed_orders_count: number;
  revenue_cents: number;
  platform_commission_cents: number;
  active_technicians_count: number;
}

export interface TechnicianReportRow {
  technician_id: string;
  technician_code: string;
  full_name: string;
  current_level: string;
  completed_orders_count: number;
  cancelled_orders_count: number;
  average_rating: number;
  quality_score: number;
  avg_response_seconds: number | null;
  open_complaints_count: number;
}

// خرائط ثابتة (whitelist) بدل ما نمرر اسم عمود كـ bind parameter — Postgres مبيسمحش بـ
// parameterize أسماء الأعمدة في ORDER BY، فلازم نتأكد إن القيمة جاية من enum مضبوط في الـ DTO
// (@IsIn) قبل ما نحطها كـ string literal في الاستعلام، مش أي مدخل خام من المستخدم.
const TECHNICIANS_REPORT_SORT_COLUMN: Record<TechniciansReportSortBy, string> = {
  completed_orders: 'tp.completed_orders_count',
  cancelled_orders: 'tp.cancelled_orders_count',
  average_rating: 'tp.average_rating',
  quality_score: 'tp.quality_score',
};

const ACTIVE_ORDER_STATUSES = [
  OrderStatus.SEARCHING_TECHNICIAN,
  OrderStatus.TECHNICIAN_ASSIGNED,
  OrderStatus.ACCEPTED,
  OrderStatus.TECHNICIAN_ON_WAY,
  OrderStatus.TECHNICIAN_ARRIVED,
  OrderStatus.IN_PROGRESS,
  OrderStatus.AWAITING_QUOTE_APPROVAL,
  OrderStatus.WORK_COMPLETED,
  OrderStatus.AWAITING_PAYMENT,
];

const CANCELLED_ORDER_STATUSES = [
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_TECHNICIAN,
  OrderStatus.CANCELLED_BY_SYSTEM,
  OrderStatus.EXPIRED,
];

@Injectable()
export class AdminReportsService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(TechnicianProfile) private readonly technicianProfiles: Repository<TechnicianProfile>,
    @InjectRepository(Complaint) private readonly complaints: Repository<Complaint>,
    @InjectRepository(Rating) private readonly ratings: Repository<Rating>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Payout) private readonly payouts: Repository<Payout>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async dashboardStats(): Promise<DashboardStats> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      ordersTodayTotal,
      ordersTodayCompleted,
      ordersTodayActive,
      ordersTodayCancelled,
      technicianApproved,
      technicianInVerification,
      technicianAvailableNow,
      complaintsOpen,
      ratingAverage,
      revenueRow,
      usersTotal,
      usersNewToday,
      usersByTypeRows,
      pendingPayoutsRow,
    ] = await Promise.all([
      this.orders.count({ where: { placedAt: MoreThanOrEqual(startOfToday) } }),
      this.orders.count({ where: { placedAt: MoreThanOrEqual(startOfToday), orderStatus: OrderStatus.COMPLETED } }),
      this.orders.count({ where: { placedAt: MoreThanOrEqual(startOfToday), orderStatus: In(ACTIVE_ORDER_STATUSES) } }),
      this.orders.count({ where: { placedAt: MoreThanOrEqual(startOfToday), orderStatus: In(CANCELLED_ORDER_STATUSES) } }),
      this.technicianProfiles.count({ where: { verificationStatus: TechnicianVerificationStatus.APPROVED } }),
      this.technicianProfiles.count({ where: { verificationStatus: In(IN_VERIFICATION_STATUSES) } }),
      this.technicianProfiles.count({
        where: { verificationStatus: TechnicianVerificationStatus.APPROVED, isAvailable: true, isOnDuty: true },
      }),
      this.complaints.count({ where: { complaintStatus: In(OPEN_COMPLAINT_STATUSES) } }),
      this.ratings
        .createQueryBuilder('r')
        .select('AVG(r.overall_rating)', 'avg')
        .getRawOne<{ avg: string | null }>(),
      this.orders
        .createQueryBuilder('o')
        .select('COALESCE(SUM(o.total_amount_cents), 0)', 'revenue')
        .addSelect('COALESCE(SUM(o.platform_commission_cents), 0)', 'commission')
        .where('o.payment_status = :paid', { paid: OrderPaymentStatus.PAID })
        .andWhere('o.paid_at >= :startOfToday', { startOfToday })
        .getRawOne<{ revenue: string; commission: string }>(),
      this.users.count(),
      this.users.count({ where: { createdAt: MoreThanOrEqual(startOfToday) } }),
      this.users
        .createQueryBuilder('u')
        .select('u.user_type', 'user_type')
        .addSelect('COUNT(*)', 'count')
        .groupBy('u.user_type')
        .getRawMany<{ user_type: string; count: string }>(),
      this.payouts
        .createQueryBuilder('p')
        .select('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(p.amount_cents), 0)', 'amount')
        .where('p.payout_status = :status', { status: PayoutStatus.UNDER_REVIEW })
        .getRawOne<{ count: string; amount: string }>(),
    ]);

    return {
      orders_today: {
        total: ordersTodayTotal,
        completed: ordersTodayCompleted,
        active: ordersTodayActive,
        cancelled: ordersTodayCancelled,
      },
      revenue_today_cents: Number(revenueRow?.revenue ?? 0),
      platform_commission_today_cents: Number(revenueRow?.commission ?? 0),
      technicians: {
        approved: technicianApproved,
        pending_verification: technicianInVerification,
        available_now: technicianAvailableNow,
      },
      complaints_open: complaintsOpen,
      average_rating: ratingAverage?.avg ? Number(ratingAverage.avg) : null,
      users: {
        total: usersTotal,
        new_today: usersNewToday,
        by_user_type: Object.fromEntries(usersByTypeRows.map((row) => [row.user_type, Number(row.count)])),
      },
      financial: {
        pending_payouts_count: Number(pendingPayoutsRow?.count ?? 0),
        pending_payouts_amount_cents: Number(pendingPayoutsRow?.amount ?? 0),
      },
    };
  }

  async revenueByPeriod(query: RevenueReportQueryDto): Promise<RevenuePeriodRow[]> {
    const rows = await this.dataSource.query<
      { period_start: Date; orders_count: string; total_amount_cents: string; platform_commission_cents: string; technician_earnings_cents: string }[]
    >(
      `SELECT date_trunc($3, paid_at) AS period_start,
              COUNT(*) AS orders_count,
              COALESCE(SUM(total_amount_cents), 0) AS total_amount_cents,
              COALESCE(SUM(platform_commission_cents), 0) AS platform_commission_cents,
              COALESCE(SUM(technician_earning_cents), 0) AS technician_earnings_cents
       FROM orders
       WHERE payment_status = 'paid' AND paid_at BETWEEN $1 AND $2
       GROUP BY period_start
       ORDER BY period_start ASC`,
      [query.from, query.to, query.group_by ?? 'day'],
    );

    return rows.map((row) => ({
      period_start: new Date(row.period_start).toISOString(),
      orders_count: Number(row.orders_count),
      total_amount_cents: Number(row.total_amount_cents),
      platform_commission_cents: Number(row.platform_commission_cents),
      technician_earnings_cents: Number(row.technician_earnings_cents),
    }));
  }

  /**
   * أداء كل فني — بيرجّع متوسط زمن الرد الحقيقي محسوب من order_assignments (sent_at→responded_at
   * لعروض اتردّ عليها صراحة، قبول أو رفض — مش timeout)، وعدد الشكاوى المفتوحة ضده كـ"issues".
   * ترتيب العمود بيتحدد من خريطة ثابتة (TECHNICIANS_REPORT_SORT_COLUMN) مش من مدخل خام —
   * الـ query_by نفسه بيتحقق منه بـ@IsIn في الـ DTO قبل ما يوصل هنا أصلاً.
   */
  async techniciansReport(
    query: TechniciansReportQueryDto,
  ): Promise<{ items: TechnicianReportRow[]; meta: { page: number; per_page: number; total: number } }> {
    const page = query.page ?? 1;
    const perPage = query.per_page ?? 20;
    const sortColumn = TECHNICIANS_REPORT_SORT_COLUMN[query.sort_by ?? 'completed_orders'];
    const sortDirection = query.order === 'asc' ? 'ASC' : 'DESC';

    const [{ total }] = await this.dataSource.query<{ total: string }[]>(
      `SELECT COUNT(*) AS total FROM technician_profiles WHERE deleted_at IS NULL`,
    );

    const rows = await this.dataSource.query<
      {
        technician_id: string;
        technician_code: string;
        full_name: string;
        current_level: string;
        completed_orders_count: number;
        cancelled_orders_count: number;
        average_rating: string;
        quality_score: string;
        avg_response_seconds: string | null;
        open_complaints_count: string;
      }[]
    >(
      `SELECT tp.id AS technician_id,
              tp.technician_code,
              u.full_name,
              tp.current_level,
              tp.completed_orders_count,
              tp.cancelled_orders_count,
              tp.average_rating,
              tp.quality_score,
              (SELECT AVG(EXTRACT(EPOCH FROM (oa.responded_at - oa.sent_at)))
                 FROM order_assignments oa
                WHERE oa.technician_id = tp.id AND oa.responded_at IS NOT NULL
                  AND oa.assignment_status IN ('accepted', 'rejected')) AS avg_response_seconds,
              (SELECT COUNT(*) FROM complaints c
                WHERE c.against_user_id = u.id
                  AND c.complaint_status IN ('open', 'under_investigation', 'awaiting_customer', 'awaiting_technician', 'escalated')) AS open_complaints_count
       FROM technician_profiles tp
       JOIN users u ON u.id = tp.user_id
       WHERE tp.deleted_at IS NULL
       ORDER BY ${sortColumn} ${sortDirection} NULLS LAST
       LIMIT $1 OFFSET $2`,
      [perPage, (page - 1) * perPage],
    );

    return {
      items: rows.map((row) => ({
        technician_id: row.technician_id,
        technician_code: row.technician_code,
        full_name: row.full_name,
        current_level: row.current_level,
        completed_orders_count: Number(row.completed_orders_count),
        cancelled_orders_count: Number(row.cancelled_orders_count),
        average_rating: Number(row.average_rating),
        quality_score: Number(row.quality_score),
        avg_response_seconds: row.avg_response_seconds ? Number(row.avg_response_seconds) : null,
        open_complaints_count: Number(row.open_complaints_count),
      })),
      meta: { page, per_page: perPage, total: Number(total) },
    };
  }

  /**
   * أداء كل نطاق خدمة (service_zone) — طلبات/إيرادات (اختياري بفترة `from`/`to`، من غيرهم
   * كل الوقت) + عدد الفنيين النشطين المتاحين فيه فعلياً (technician_zones.is_active=true
   * + verification_status='approved'، مش مجرد وجود صف). عدد النطاقات صغير عادةً (عشرات
   * مش آلاف)، فمفيش صفحات هنا عكس تقرير الفنيين.
   */
  async zonesReport(query: ZonesReportQueryDto): Promise<ZoneReportRow[]> {
    const rows = await this.dataSource.query<
      {
        zone_id: string;
        name_ar: string;
        name_en: string;
        city_id: string;
        city_name_ar: string;
        is_active: boolean;
        surge_multiplier: string;
        orders_count: string;
        completed_orders_count: string;
        revenue_cents: string;
        platform_commission_cents: string;
        active_technicians_count: string;
      }[]
    >(
      `SELECT sz.id AS zone_id,
              sz.name_ar,
              sz.name_en,
              sz.city_id,
              c.name_ar AS city_name_ar,
              sz.is_active,
              sz.surge_multiplier,
              COUNT(o.id) AS orders_count,
              COUNT(o.id) FILTER (WHERE o.order_status = 'completed') AS completed_orders_count,
              COALESCE(SUM(o.total_amount_cents) FILTER (WHERE o.payment_status = 'paid'), 0) AS revenue_cents,
              COALESCE(SUM(o.platform_commission_cents) FILTER (WHERE o.payment_status = 'paid'), 0) AS platform_commission_cents,
              (SELECT COUNT(*) FROM technician_zones tz
                 JOIN technician_profiles tp ON tp.id = tz.technician_id
                WHERE tz.service_zone_id = sz.id AND tz.is_active = true AND tz.deleted_at IS NULL
                  AND tp.verification_status = 'approved') AS active_technicians_count
       FROM service_zones sz
       JOIN cities c ON c.id = sz.city_id
       LEFT JOIN orders o ON o.service_zone_id = sz.id
         AND ($1::timestamptz IS NULL OR o.placed_at >= $1)
         AND ($2::timestamptz IS NULL OR o.placed_at <= $2)
       WHERE sz.deleted_at IS NULL
       GROUP BY sz.id, c.name_ar
       ORDER BY sz.name_ar ASC`,
      [query.from ?? null, query.to ?? null],
    );

    return rows.map((row) => ({
      zone_id: row.zone_id,
      name_ar: row.name_ar,
      name_en: row.name_en,
      city_id: row.city_id,
      city_name_ar: row.city_name_ar,
      is_active: row.is_active,
      surge_multiplier: row.surge_multiplier,
      orders_count: Number(row.orders_count),
      completed_orders_count: Number(row.completed_orders_count),
      revenue_cents: Number(row.revenue_cents),
      platform_commission_cents: Number(row.platform_commission_cents),
      active_technicians_count: Number(row.active_technicians_count),
    }));
  }
}
