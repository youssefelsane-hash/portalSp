import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import { SettingsService } from '../settings/settings.service';
import {
  classifyTechnicianCapacity,
  TechnicianCapacityTier,
} from './technician-eligibility.sql';
import { TechnicianActivityService } from './technician-activity.service';
import { TechnicianLevel, TechnicianVerificationStatus } from './entities/technician-profile.entity';

const FULL_DAY_JOB_MINUTES_FALLBACK = 360;
const GENERIC_SERVICE_DURATION_MINUTES = 60;

export interface CategoryOpsFilters {
  categoryId: string;
  zoneId?: string;
  verificationStatus?: TechnicianVerificationStatus;
  level?: TechnicianLevel;
  /** بحث بالاسم/كود الفني (docs/08 §36.12) — ILIKE بسيط، صفر full-text search محرّك جديد. */
  q?: string;
  page: number;
  perPage: number;
}

export interface CategoryOpsRow {
  id: string;
  technicianCode: string;
  fullName: string;
  phoneNumber: string;
  verificationStatus: TechnicianVerificationStatus;
  currentLevel: TechnicianLevel;
  online: boolean;
  lastActiveAt: Date | null;
  workingNow: boolean;
  capacityTierToday: TechnicianCapacityTier;
  openRequestsCount: number;
  crewLeaderShortageCount: number;
  crewRecruitOpenOffersCount: number;
  zoneCount: number;
  categoryCount: number;
  hasZoneIssue: boolean;
  hasCategoryIssue: boolean;
}

interface RawRow {
  id: string;
  technician_code: string;
  user_id: string;
  full_name: string;
  phone_number: string;
  verification_status: TechnicianVerificationStatus;
  current_level: TechnicianLevel;
  total_count: string;
}

/**
 * مركز عمليات فئة (docs/08 §35.9، ADR-0021 §5) — "Admin → Technicians → كهرباء" مثلاً: مجمّع
 * العرض الكامل لفئة بحالات غنية حقيقية، صفر خوارزمية تشخيصية موازية — كل حالة هنا بتُستهلك من
 * نفس الدوال/الجداول الحقيقية المستخدمة في المطابقة الفعلية (`classifyTechnicianCapacity()`،
 * `TechnicianActivityService`، `order_assignments`/`technician_work_opportunities` الحقيقيين).
 *
 * **أداء (طلب المالك: "avoid expensive synchronous diagnostics at scale")**: استعلام أساسي واحد
 * مُصفّح (paginated) لجلب صفحة الفنيين، بعدين إثراء **الصفحة دي بس** (مش المجمّع كله) بـ:
 * أونلاين/آخر نشاط (استعلام batch واحد)، عدّادات الطلبات/الفرص المفتوحة (استعلام واحد مجمّع)،
 * نطاقات/فئات (استعلام واحد مجمّع)، وتصنيف القدرة (`classifyTechnicianCapacity()`، نداء واحد لكل
 * فني في الصفحة — محدود بحجم الصفحة، مش سكان لمجمّع الفنيين كله).
 *
 * **فلتر منطقة اختياري (docs/08 §36.3، "مصفوفة القوى العاملة")**: `zoneId` بيضيف شرط `EXISTS` على
 * `technician_zones` (نفس الجدول اللي `zone_count` أصلًا بيتحسب منه فوق) — تعديل جراحي واحد على
 * استعلام الأساس، صفر تكرار منطق أهلية جديد. الأدمن بيختار مدينة→نطاق (نفس نمط `geo/page.tsx`)
 * ثم فئة (فلتر السطر ده الأساسي أصلًا) — تصفح Region→Zone→Category→Technician بالحرف.
 *
 * **online/offline observability بحت** (تحذير المالك المتكرر مرتين في §35): الحقل ده معروض بس،
 * صفر تأثير على أي فلترة/ترتيب أهلية هنا. **قيد متعمّد**: مفيش فلتر `online_only` على مستوى
 * الصفحة/الترقيم — الحالة دي in-memory محلية (`RealtimeSessionRegistry`)، مش عمود SQL يتفلتر
 * بيه قبل `LIMIT`/`OFFSET` بكفاءة. فلترتها هتحتاج جلب المجمّع كله وفلترته في التطبيق (بالظبط
 * "avoid expensive synchronous diagnostics at scale" اللي المالك حذّر منه) — الأدمن يقدر يشوف
 * `online` في كل صف بدل كده، بلا فلتر مخصوص لحد ما يتطلب صراحة لاحقًا بتصميم مختلف.
 */
@Injectable()
export class AdminTechnicianCategoryOpsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    private readonly activityService: TechnicianActivityService,
  ) {}

  async list(filters: CategoryOpsFilters): Promise<{ items: CategoryOpsRow[]; meta: { page: number; perPage: number; total: number } }> {
    const offset = (filters.page - 1) * filters.perPage;

    const rawRows = await this.dataSource.query<RawRow[]>(
      `
      SELECT tp.id, tp.technician_code, tp.user_id, tp.verification_status, tp.current_level,
             u.full_name, u.phone_number,
             COUNT(*) OVER() AS total_count
      FROM technician_profiles tp
      JOIN users u ON u.id = tp.user_id
      WHERE tp.deleted_at IS NULL
        AND (
          EXISTS (
            SELECT 1 FROM technician_categories tc
            WHERE tc.technician_id = tp.id AND tc.category_id = $1 AND tc.is_active = true
          )
          OR EXISTS (
            SELECT 1 FROM technician_services ts
            JOIN services s ON s.id = ts.service_id
            WHERE ts.technician_id = tp.id AND s.category_id = $1 AND ts.is_active = true
          )
        )
        AND ($2::technician_verification_status IS NULL OR tp.verification_status = $2)
        AND ($3::technician_level IS NULL OR tp.current_level = $3)
        AND (
          $4::uuid IS NULL
          OR EXISTS (
            SELECT 1 FROM technician_zones tz
            WHERE tz.technician_id = tp.id AND tz.service_zone_id = $4 AND tz.is_active = true
          )
        )
        AND ($7::text IS NULL OR u.full_name ILIKE '%' || $7 || '%' OR tp.technician_code ILIKE '%' || $7 || '%')
      ORDER BY u.full_name ASC
      LIMIT $5 OFFSET $6
      `,
      [
        filters.categoryId,
        filters.verificationStatus ?? null,
        filters.level ?? null,
        filters.zoneId ?? null,
        filters.perPage,
        offset,
        filters.q?.trim() || null,
      ],
    );

    const total = rawRows.length > 0 ? Number(rawRows[0].total_count) : 0;
    if (rawRows.length === 0) return { items: [], meta: { page: filters.page, perPage: filters.perPage, total: 0 } };

    const profileIds = rawRows.map((r) => r.id);
    const userIds = rawRows.map((r) => r.user_id);

    const [activitySnapshot, workingRows, zoneCategoryRows, requestRows, crewLeaderRows, crewOfferRows] = await Promise.all([
      this.activityService.getActivitySnapshot(userIds),
      this.dataSource.query<{ technician_id: string }[]>(
        `SELECT DISTINCT technician_id FROM orders WHERE technician_id = ANY($1::uuid[]) AND order_status = ANY($2::order_status[]) AND deleted_at IS NULL`,
        [profileIds, ACTIVE_TECHNICIAN_ORDER_STATUSES],
      ),
      this.dataSource.query<{ technician_id: string; zone_count: string; category_count: string }[]>(
        `SELECT tp.id AS technician_id,
                (SELECT COUNT(*) FROM technician_zones tz WHERE tz.technician_id = tp.id AND tz.is_active = true) AS zone_count,
                (SELECT COUNT(*) FROM technician_categories tc WHERE tc.technician_id = tp.id AND tc.is_active = true) AS category_count
         FROM technician_profiles tp WHERE tp.id = ANY($1::uuid[])`,
        [profileIds],
      ),
      this.dataSource.query<{ technician_id: string; open_requests_count: string }[]>(
        `SELECT technician_id, COUNT(*) AS open_requests_count FROM (
           SELECT technician_id FROM order_assignments WHERE technician_id = ANY($1::uuid[]) AND assignment_status = 'sent'
           UNION ALL
           SELECT technician_id FROM technician_work_opportunities WHERE technician_id = ANY($1::uuid[]) AND status = 'offered' AND deleted_at IS NULL
         ) t GROUP BY technician_id`,
        [profileIds],
      ),
      // قائد طلب فريق طاقمه لسه ناقص (docs/08 §35.9 — "crew shortage involvement") — عدّاد بس هنا،
      // مش تكرار منطق computeCrewComposition() الكامل (مصممة لطلب واحد، مش لمجموعة قادة دفعة واحدة).
      this.dataSource.query<{ technician_id: string; crew_leader_shortage_count: string }[]>(
        `SELECT o.technician_id, COUNT(*) AS crew_leader_shortage_count
         FROM orders o
         WHERE o.technician_id = ANY($1::uuid[]) AND o.booking_mode = 'team' AND o.deleted_at IS NULL
           AND o.order_status = ANY($2::order_status[])
           AND (
             1 + COALESCE((SELECT COUNT(*) FROM order_team_members otm WHERE otm.order_id = o.id AND otm.member_type = 'team_member'), 0)
               < COALESCE(o.required_technicians, 1)
             OR COALESCE((SELECT COUNT(*) FROM order_team_members otm WHERE otm.order_id = o.id AND otm.member_type = 'assistant'), 0)
               < COALESCE(o.required_assistants, 0)
           )
         GROUP BY o.technician_id`,
        [profileIds, ACTIVE_TECHNICIAN_ORDER_STATUSES],
      ),
      this.dataSource.query<{ technician_id: string; crew_recruit_open_offers_count: string }[]>(
        `SELECT technician_id, COUNT(*) AS crew_recruit_open_offers_count FROM technician_work_opportunities
         WHERE technician_id = ANY($1::uuid[]) AND context = 'crew_recruit' AND status = 'offered' AND deleted_at IS NULL
         GROUP BY technician_id`,
        [profileIds],
      ),
    ]);

    const workingSet = new Set(workingRows.map((r) => r.technician_id));
    const zoneCategoryById = new Map(zoneCategoryRows.map((r) => [r.technician_id, r]));
    const requestsById = new Map(requestRows.map((r) => [r.technician_id, Number(r.open_requests_count)]));
    const crewLeaderById = new Map(crewLeaderRows.map((r) => [r.technician_id, Number(r.crew_leader_shortage_count)]));
    const crewOfferById = new Map(crewOfferRows.map((r) => [r.technician_id, Number(r.crew_recruit_open_offers_count)]));

    const fullDayJobMinutes = await this.settingsService.getNumber('matching.full_day_job_minutes', FULL_DAY_JOB_MINUTES_FALLBACK);

    // تصنيف القدرة "النهاردة" لكل فني في الصفحة — محدود بحجم الصفحة (bounded)، مش سكان لمجمّع كامل.
    const capacityTiers = await Promise.all(
      rawRows.map((r) =>
        classifyTechnicianCapacity(this.dataSource, {
          technicianId: r.id,
          scheduledAt: null,
          excludeOrderId: null,
          serviceDurationMinutes: GENERIC_SERVICE_DURATION_MINUTES,
          fullDayThresholdMinutes: fullDayJobMinutes,
        }),
      ),
    );

    const items: CategoryOpsRow[] = rawRows.map((r, index) => {
      const activity = activitySnapshot.get(r.user_id) ?? { online: false, lastActiveAt: null };
      const zoneCategory = zoneCategoryById.get(r.id);
      const zoneCount = Number(zoneCategory?.zone_count ?? 0);
      const categoryCount = Number(zoneCategory?.category_count ?? 0);
      return {
        id: r.id,
        technicianCode: r.technician_code,
        fullName: r.full_name,
        phoneNumber: r.phone_number,
        verificationStatus: r.verification_status,
        currentLevel: r.current_level,
        online: activity.online,
        lastActiveAt: activity.lastActiveAt,
        workingNow: workingSet.has(r.id),
        capacityTierToday: capacityTiers[index],
        openRequestsCount: requestsById.get(r.id) ?? 0,
        crewLeaderShortageCount: crewLeaderById.get(r.id) ?? 0,
        crewRecruitOpenOffersCount: crewOfferById.get(r.id) ?? 0,
        zoneCount,
        categoryCount,
        hasZoneIssue: zoneCount === 0,
        hasCategoryIssue: categoryCount === 0,
      };
    });

    return { items, meta: { page: filters.page, perPage: filters.perPage, total } };
  }
}
