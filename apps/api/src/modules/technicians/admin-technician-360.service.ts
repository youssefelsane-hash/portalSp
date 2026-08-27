import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import { OrderStatus } from '../orders/entities/order.entity';
import { SettingsService } from '../settings/settings.service';
import { describeTechnicianCapacity, TechnicianCapacityDescription } from './technician-eligibility.sql';
import { TechnicianActivityService, TechnicianActivitySnapshot } from './technician-activity.service';

const FULL_DAY_JOB_MINUTES_FALLBACK = 360;
const RECENT_CANCELLATION_WINDOW_DAYS = 90;
// طلبات "حالية/قادمة" — نفس ACTIVE_TECHNICIAN_ORDER_STATUSES زائد technician_assigned (قائد طلب
// فريق اتعيّن بس طاقمه لسه ناقص، §35.1 — لسه "شغل جاي" من منظور الأدمن حتى لو مش technician-active
// رسميًا بمعنى order-state-machine.ts).
const CURRENT_UPCOMING_ORDER_STATUSES: OrderStatus[] = [OrderStatus.TECHNICIAN_ASSIGNED, ...ACTIVE_TECHNICIAN_ORDER_STATUSES];

export interface Technician360Identity {
  id: string;
  technicianCode: string;
  fullName: string;
  phoneNumber: string;
  yearsOfExperience: number;
  currentLevel: string;
  verificationStatus: string;
  createdAt: Date;
}

export interface Technician360CategoryRow {
  categoryId: string;
  nameAr: string;
  isActive: boolean;
  verificationStatus: string;
}

export interface Technician360ZoneRow {
  zoneId: string;
  nameAr: string;
  isActive: boolean;
}

export interface Technician360TeamRole {
  companyId: string;
  companyName: string;
  isOwner: boolean;
}

// الفريق المفضّل (docs/08 §36.19، ADR-0022) — رؤية أدمن قراءة بس، صفر endpoints جديدة للتعديل
// (لسه بتُدار من الفني نفسه عبر /technician/preferred-crew* — العلاقة تفضيل شخصي بحت بلا موافقة
// أدمن أصلاً، زي ما اتقرر في ADR-0022). asOwner = فنيين دعاهم/مقبولين في فريقه، asMember = فرق
// فنيين تانيين هو عضو مقبول فيها.
export interface Technician360PreferredCrewRow {
  id: string;
  technicianId: string;
  technicianCode: string;
  fullName: string;
  status: string;
}

export interface Technician360JobRow {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  scheduledAt: Date | null;
  serviceNameAr: string;
}

export interface Technician360BlockedDateRow {
  slotDate: string;
  startTime: string;
  endTime: string;
}

export interface Technician360Performance {
  averageRating: number;
  totalRatingsCount: number;
  completedOrdersCount: number;
  cancelledOrdersCount: number;
}

export interface Technician360CancellationBehavior {
  totalCancellations: number;
  recentCancellations: number;
}

export interface Technician360ComplaintRow {
  id: string;
  severity: string;
  status: string;
  createdAt: Date;
}

export interface Technician360Complaints {
  openCount: number;
  totalCount: number;
  recent: Technician360ComplaintRow[];
}

export interface Technician360Wallet {
  balanceCents: number;
  pendingBalanceCents: number;
  totalEarnedCents: number;
  isFrozen: boolean;
}

export interface Technician360PayoutRow {
  id: string;
  payoutNumber: string;
  netAmountCents: number;
  payoutStatus: string;
  requestedAt: Date;
  completedAt: Date | null;
}

export interface Technician360Profile {
  identity: Technician360Identity;
  categories: Technician360CategoryRow[];
  zones: Technician360ZoneRow[];
  activity: TechnicianActivitySnapshot;
  capacityToday: TechnicianCapacityDescription;
  teamRole: Technician360TeamRole | null;
  currentAndUpcomingJobs: Technician360JobRow[];
  blockedDates: Technician360BlockedDateRow[];
  openOpportunitiesCount: number;
  performance: Technician360Performance;
  cancellationBehavior: Technician360CancellationBehavior;
  complaints: Technician360Complaints;
  wallet: Technician360Wallet | null;
  recentPayouts: Technician360PayoutRow[];
  preferredCrewAsOwner: Technician360PreferredCrewRow[];
  preferredCrewAsMember: Technician360PreferredCrewRow[];
}

/**
 * بروفايل فني 360° (docs/08 §35.11، ADR-0021 §5) — تجميعة واحدة لكل حاجة الأدمن محتاج يشوفها عن
 * فني بعينه في مكان واحد، بدل ما يقفز بين 6-7 شاشات منفصلة. **إعادة استخدام صريحة، صفر منطق
 * جديد**: `describeTechnicianCapacity()` (§34.4)، `TechnicianActivityService` (§35.10) — كل قيمة
 * هنا محسوبة بنفس الدوال/الجداول الحقيقية المستخدمة في باقي المنصة، صفر رقم مُلفَّق. **قراءة بس**
 * — أي فعل إداري (اعتماد/رفض/تعليق/إضافة لطاقم/...) بيفضل يتعمل عبر endpoints الأدمن الموجودة
 * فعلاً (`AdminTechniciansController`/`AdminOrdersController`)، مش منطق جديد مكرر هنا (طلب المالك:
 * "actionable — reusing existing endpoints/services, no duplicated mutation logic").
 */
@Injectable()
export class AdminTechnician360Service {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    private readonly activityService: TechnicianActivityService,
  ) {}

  async getProfile(technicianProfileId: string): Promise<Technician360Profile> {
    const [identityRow] = await this.dataSource.query<
      {
        id: string;
        technician_code: string;
        user_id: string;
        full_name: string;
        phone_number: string;
        years_of_experience: number;
        current_level: string;
        verification_status: string;
        created_at: Date;
        average_rating: string;
        total_ratings_count: number;
        completed_orders_count: number;
        cancelled_orders_count: number;
        company_id: string | null;
        company_name: string | null;
        company_owner_user_id: string | null;
      }[]
    >(
      `SELECT tp.id, tp.technician_code, tp.user_id, u.full_name, u.phone_number, tp.years_of_experience,
              tp.current_level, tp.verification_status, tp.created_at,
              tp.average_rating, tp.total_ratings_count, tp.completed_orders_count, tp.cancelled_orders_count,
              tc.id AS company_id, tc.name AS company_name, tc.owner_user_id AS company_owner_user_id
       FROM technician_profiles tp
       JOIN users u ON u.id = tp.user_id
       LEFT JOIN technician_companies tc ON tc.id = tp.company_id
       WHERE tp.id = $1 AND tp.deleted_at IS NULL`,
      [technicianProfileId],
    );
    if (!identityRow) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني غير موجود', HttpStatus.NOT_FOUND);
    }

    const fullDayJobMinutes = await this.settingsService.getNumber('matching.full_day_job_minutes', FULL_DAY_JOB_MINUTES_FALLBACK);

    const [
      categories,
      zones,
      activity,
      capacityToday,
      jobs,
      blockedDates,
      openRequestRows,
      cancellationRows,
      complaintRows,
      complaintCounts,
      walletRows,
      payoutRows,
      preferredCrewAsOwnerRows,
      preferredCrewAsMemberRows,
    ] = await Promise.all([
      this.dataSource.query<{ category_id: string; name_ar: string; is_active: boolean; verification_status: string }[]>(
        `SELECT tc.category_id, sc.name_ar, tc.is_active, tc.verification_status
         FROM technician_categories tc JOIN service_categories sc ON sc.id = tc.category_id
         WHERE tc.technician_id = $1 ORDER BY sc.name_ar ASC`,
        [technicianProfileId],
      ),
      this.dataSource.query<{ zone_id: string; name_ar: string; is_active: boolean }[]>(
        `SELECT tz.service_zone_id AS zone_id, sz.name_ar, tz.is_active
         FROM technician_zones tz JOIN service_zones sz ON sz.id = tz.service_zone_id
         WHERE tz.technician_id = $1 ORDER BY sz.name_ar ASC`,
        [technicianProfileId],
      ),
      this.activityService.getActivityForUser(identityRow.user_id),
      describeTechnicianCapacity(this.dataSource, {
        technicianId: technicianProfileId,
        date: new Date().toISOString().slice(0, 10),
        fullDayThresholdMinutes: fullDayJobMinutes,
      }),
      this.dataSource.query<{ order_id: string; order_number: string; order_status: string; scheduled_at: Date | null; service_name_ar: string }[]>(
        `SELECT o.id AS order_id, o.order_number, o.order_status, o.scheduled_at, s.name_ar AS service_name_ar
         FROM orders o JOIN services s ON s.id = o.service_id
         WHERE o.technician_id = $1 AND o.deleted_at IS NULL AND o.order_status = ANY($2::order_status[])
         ORDER BY COALESCE(o.scheduled_at, o.created_at) ASC
         LIMIT 10`,
        [technicianProfileId, CURRENT_UPCOMING_ORDER_STATUSES],
      ),
      this.dataSource.query<{ slot_date: string; start_time: string; end_time: string }[]>(
        `SELECT TO_CHAR(slot_date, 'YYYY-MM-DD') AS slot_date, start_time::text, end_time::text
         FROM technician_schedule_slots
         WHERE technician_id = $1 AND status = 'blocked' AND deleted_at IS NULL AND slot_date >= CURRENT_DATE
         ORDER BY slot_date ASC LIMIT 20`,
        [technicianProfileId],
      ),
      this.dataSource.query<{ count: string }[]>(
        `SELECT COUNT(*) AS count FROM (
           -- 'viewed' برضه عرض مفتوح لسه مستني رد (docs/08 §72) — مش رد ولا انتهت مهلته.
           SELECT 1 FROM order_assignments WHERE technician_id = $1 AND assignment_status IN ('sent', 'viewed')
           UNION ALL
           SELECT 1 FROM technician_work_opportunities WHERE technician_id = $1 AND status = 'offered' AND deleted_at IS NULL
         ) t`,
        [technicianProfileId],
      ),
      this.dataSource.query<{ total: string; recent: string }[]>(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE created_at >= now() - ($2 || ' days')::interval) AS recent
         FROM technician_order_cancellations WHERE technician_id = $1`,
        [technicianProfileId, RECENT_CANCELLATION_WINDOW_DAYS],
      ),
      this.dataSource.query<{ id: string; severity: string; complaint_status: string; created_at: Date }[]>(
        `SELECT id, severity, complaint_status, created_at FROM complaints
         WHERE against_user_id = $1 ORDER BY created_at DESC LIMIT 10`,
        [identityRow.user_id],
      ),
      this.dataSource.query<{ open_count: string; total_count: string }[]>(
        `SELECT COUNT(*) FILTER (WHERE complaint_status = 'open') AS open_count, COUNT(*) AS total_count
         FROM complaints WHERE against_user_id = $1`,
        [identityRow.user_id],
      ),
      this.dataSource.query<{ balance_cents: number; pending_balance_cents: number; total_earned_cents: number; is_frozen: boolean }[]>(
        `SELECT balance_cents, pending_balance_cents, total_earned_cents, is_frozen
         FROM wallets WHERE owner_user_id = $1 AND deleted_at IS NULL`,
        [identityRow.user_id],
      ),
      this.dataSource.query<
        { id: string; payout_number: string; net_amount_cents: number; payout_status: string; requested_at: Date; completed_at: Date | null }[]
      >(
        `SELECT id, payout_number, net_amount_cents, payout_status, requested_at, completed_at
         FROM payouts WHERE technician_id = $1 ORDER BY requested_at DESC LIMIT 5`,
        [technicianProfileId],
      ),
      this.dataSource.query<{ id: string; technician_id: string; technician_code: string; full_name: string; status: string }[]>(
        `SELECT pcm.id, tp.id AS technician_id, tp.technician_code, u.full_name, pcm.status
         FROM technician_preferred_crew_members pcm
         JOIN technician_profiles tp ON tp.id = pcm.member_technician_id
         JOIN users u ON u.id = tp.user_id
         WHERE pcm.owner_technician_id = $1 AND pcm.deleted_at IS NULL AND pcm.status IN ('invited','accepted')
         ORDER BY pcm.invited_at DESC`,
        [technicianProfileId],
      ),
      this.dataSource.query<{ id: string; technician_id: string; technician_code: string; full_name: string; status: string }[]>(
        `SELECT pcm.id, tp.id AS technician_id, tp.technician_code, u.full_name, pcm.status
         FROM technician_preferred_crew_members pcm
         JOIN technician_profiles tp ON tp.id = pcm.owner_technician_id
         JOIN users u ON u.id = tp.user_id
         WHERE pcm.member_technician_id = $1 AND pcm.deleted_at IS NULL AND pcm.status = 'accepted'
         ORDER BY pcm.responded_at DESC`,
        [technicianProfileId],
      ),
    ]);

    return {
      identity: {
        id: identityRow.id,
        technicianCode: identityRow.technician_code,
        fullName: identityRow.full_name,
        phoneNumber: identityRow.phone_number,
        yearsOfExperience: identityRow.years_of_experience,
        currentLevel: identityRow.current_level,
        verificationStatus: identityRow.verification_status,
        createdAt: identityRow.created_at,
      },
      categories: categories.map((c) => ({
        categoryId: c.category_id,
        nameAr: c.name_ar,
        isActive: c.is_active,
        verificationStatus: c.verification_status,
      })),
      zones: zones.map((z) => ({ zoneId: z.zone_id, nameAr: z.name_ar, isActive: z.is_active })),
      activity,
      capacityToday,
      teamRole: identityRow.company_id
        ? {
            companyId: identityRow.company_id,
            companyName: identityRow.company_name!,
            isOwner: identityRow.company_owner_user_id === identityRow.user_id,
          }
        : null,
      currentAndUpcomingJobs: jobs.map((j) => ({
        orderId: j.order_id,
        orderNumber: j.order_number,
        orderStatus: j.order_status,
        scheduledAt: j.scheduled_at,
        serviceNameAr: j.service_name_ar,
      })),
      blockedDates: blockedDates.map((b) => ({ slotDate: b.slot_date, startTime: b.start_time, endTime: b.end_time })),
      openOpportunitiesCount: Number(openRequestRows[0]?.count ?? 0),
      performance: {
        averageRating: Number(identityRow.average_rating),
        totalRatingsCount: identityRow.total_ratings_count,
        completedOrdersCount: identityRow.completed_orders_count,
        cancelledOrdersCount: identityRow.cancelled_orders_count,
      },
      cancellationBehavior: {
        totalCancellations: Number(cancellationRows[0]?.total ?? 0),
        recentCancellations: Number(cancellationRows[0]?.recent ?? 0),
      },
      complaints: {
        openCount: Number(complaintCounts[0]?.open_count ?? 0),
        totalCount: Number(complaintCounts[0]?.total_count ?? 0),
        recent: complaintRows.map((c) => ({ id: c.id, severity: c.severity, status: c.complaint_status, createdAt: c.created_at })),
      },
      wallet: walletRows[0]
        ? {
            balanceCents: walletRows[0].balance_cents,
            pendingBalanceCents: walletRows[0].pending_balance_cents,
            totalEarnedCents: walletRows[0].total_earned_cents,
            isFrozen: walletRows[0].is_frozen,
          }
        : null,
      recentPayouts: payoutRows.map((p) => ({
        id: p.id,
        payoutNumber: p.payout_number,
        netAmountCents: p.net_amount_cents,
        payoutStatus: p.payout_status,
        requestedAt: p.requested_at,
        completedAt: p.completed_at,
      })),
      preferredCrewAsOwner: preferredCrewAsOwnerRows.map((r) => ({
        id: r.id,
        technicianId: r.technician_id,
        technicianCode: r.technician_code,
        fullName: r.full_name,
        status: r.status,
      })),
      preferredCrewAsMember: preferredCrewAsMemberRows.map((r) => ({
        id: r.id,
        technicianId: r.technician_id,
        technicianCode: r.technician_code,
        fullName: r.full_name,
        status: r.status,
      })),
    };
  }
}
