import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, MoreThanOrEqual, Repository } from 'typeorm';
import { Complaint, ComplaintStatus } from '../support/entities/complaint.entity';
import { Order, OrderPaymentStatus, OrderStatus } from '../orders/entities/order.entity';
import { Rating } from '../ratings/entities/rating.entity';
import { TechnicianProfile, TechnicianVerificationStatus } from '../technicians/entities/technician-profile.entity';
import { RevenueReportQueryDto } from './dto/revenue-report-query.dto';

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
}

export interface RevenuePeriodRow {
  period_start: string;
  orders_count: number;
  total_amount_cents: number;
  platform_commission_cents: number;
  technician_earnings_cents: number;
}

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
}
