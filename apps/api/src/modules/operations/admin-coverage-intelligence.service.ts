import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import { DISPATCH_PENDING_STATUSES } from './admin-operations-overview.service';
import { resolveDailyCapacityMinutes } from '../technicians/technician-day-capacity.sql';

// نفس افتراض capacity_today (§36.2)/عرض الحمل القريب (§36.4) — مفيش طلب مرشّح فعلي هنا، معاينة
// عامة بس (technician-eligibility.sql.ts:258).
const GENERIC_SERVICE_DURATION_MINUTES = 60;

export type CoverageStatus = 'critical' | 'tight' | 'healthy';

export interface CoverageFilters {
  categoryId?: string | null;
  zoneId?: string | null;
  page: number;
  perPage: number;
}

export interface CoverageRow {
  zoneId: string;
  zoneName: string;
  categoryId: string;
  categoryName: string;
  techniciansTotal: number;
  techniciansLight: number;
  techniciansMeaningful: number;
  techniciansHeavy: number;
  techniciansBlocked: number;
  dispatchPendingCount: number;
  coverageStatus: CoverageStatus;
}

interface RawRow {
  service_zone_id: string;
  zone_name: string;
  category_id: string;
  category_name: string;
  technicians_total: string;
  technicians_light: string;
  technicians_meaningful: string;
  technicians_heavy: string;
  technicians_blocked: string;
  dispatch_pending_count: string;
  total_count: string;
}

/**
 * ذكاء تغطية القوى العاملة — فئة+منطقة (docs/08 §36.10). صفر صيغة تصنيف قدرة موازية: كل فني بيتصنّف
 * بنفس شروط `classifyTechnicianCapacity()` بالحرف (نفس أولوية BLOCKED > HEAVY > MEANINGFUL > LIGHT،
 * technician-eligibility.sql.ts)، ونفس تعريف "طلب لسه بيدوّر على فني" من `DISPATCH_PENDING_STATUSES`
 * (§36.2، `admin-operations-overview.service.ts`) — صفر مصدر حقيقة تاني.
 *
 * **الجديد الحقيقي هنا مش التصنيف نفسه — الجمع بين الجانبين في صف واحد**: عرض (فنيين LIGHT/
 * MEANINGFUL متاحين النهاردة) مقابل طلب (طلبات لسه بتدوّر) *لكل زوج (منطقة، فئة)*، مع `FULL OUTER
 * JOIN`-مماثل بين الجانبين — زوج عنده طلبات لسه بتدوّر بس **صفر فني مسجّل خالص** في المنطقة/الفئة
 * دي (أخطر حالة تغطية ممكنة) بيظهر برضه، مش بس الأزواج اللي فيها فنيين مسجّلين. `coverage_status`
 * تصنيف مُشتقّ بسيط في TS (مش SQL، عشان يفضل واضح ومقروء): `critical` = فيه طلبات بتدوّر وصفر فني
 * LIGHT/MEANINGFUL متاح، `tight` = الطلبات أكتر من الفنيين المتاحين، `healthy` = غير كده. صفر عتبة
 * نسبة مخترعة (زي "80% تغطية") — قرارات ثنائية/نسبية بسيطة بس من أرقام حقيقية.
 */
@Injectable()
export class AdminCoverageIntelligenceService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
  ) {}

  async getCoverage(filters: CoverageFilters): Promise<{ items: CoverageRow[]; meta: { page: number; perPage: number; total: number } }> {
    const offset = (filters.page - 1) * filters.perPage;
    const categoryId = filters.categoryId ?? null;
    const zoneId = filters.zoneId ?? null;
    const dailyCapacityMinutes = await resolveDailyCapacityMinutes(this.settingsService);

    const rawRows = await this.dataSource.query<RawRow[]>(
      `
      WITH target AS (
        SELECT (now() AT TIME ZONE 'Africa/Cairo')::date AS target_date
      ),
      tech_pairs AS (
        SELECT tz.service_zone_id, tc.category_id, tp.id AS technician_id
        FROM technician_zones tz
        JOIN technician_categories tc ON tc.technician_id = tz.technician_id
        JOIN technician_profiles tp ON tp.id = tz.technician_id
        WHERE tz.is_active = true AND tz.deleted_at IS NULL
          AND tc.is_active = true AND tc.verification_status = 'approved'
          AND tp.deleted_at IS NULL AND tp.verification_status = 'approved'
          AND ($1::uuid IS NULL OR tc.category_id = $1)
          AND ($2::uuid IS NULL OR tz.service_zone_id = $2)
      ),
      classified AS (
        SELECT tpair.service_zone_id, tpair.category_id, tpair.technician_id,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM technician_schedule_slots tss, target
              WHERE tss.technician_id = tpair.technician_id AND tss.status = 'blocked' AND tss.deleted_at IS NULL
                AND tss.slot_date = target.target_date
            ) THEN 'BLOCKED'
            WHEN EXISTS (
              SELECT 1 FROM orders co
              JOIN services cs ON cs.id = co.service_id, target
              WHERE co.technician_id = tpair.technician_id AND co.order_status = ANY($3::order_status[]) AND co.deleted_at IS NULL
                AND (COALESCE(co.scheduled_at, now()) AT TIME ZONE 'Africa/Cairo')::date = target.target_date
                AND (
                  co.order_status = ANY($4::order_status[])
                  OR COALESCE(co.estimated_duration_days, 0) >= 1
                  OR COALESCE(cs.estimated_duration_minutes, 60) >= $5::int
                  OR $6::int >= $5::int
                )
                -- $5 = dailyCapacityMinutes (العتبة)، $6 = GENERIC_SERVICE_DURATION_MINUTES (قيمة
                -- افتراضية لو مفيش خدمة مرشّحة فعلية) — نفس ترتيب admin-operations-overview.service.ts بالحرف.
            ) THEN 'HEAVY'
            WHEN EXISTS (
              SELECT 1 FROM orders co, target
              WHERE co.technician_id = tpair.technician_id AND co.order_status = ANY($3::order_status[]) AND co.deleted_at IS NULL
                AND (COALESCE(co.scheduled_at, now()) AT TIME ZONE 'Africa/Cairo')::date = target.target_date
            ) THEN 'MEANINGFUL'
            ELSE 'LIGHT'
          END AS tier
        FROM tech_pairs tpair
      ),
      supply AS (
        SELECT service_zone_id, category_id,
          COUNT(*) AS technicians_total,
          COUNT(*) FILTER (WHERE tier = 'LIGHT') AS technicians_light,
          COUNT(*) FILTER (WHERE tier = 'MEANINGFUL') AS technicians_meaningful,
          COUNT(*) FILTER (WHERE tier = 'HEAVY') AS technicians_heavy,
          COUNT(*) FILTER (WHERE tier = 'BLOCKED') AS technicians_blocked
        FROM classified
        GROUP BY service_zone_id, category_id
      ),
      demand AS (
        SELECT o.service_zone_id, s.category_id, COUNT(*) AS dispatch_pending_count
        FROM orders o
        JOIN services s ON s.id = o.service_id
        WHERE o.deleted_at IS NULL AND o.order_status = ANY($7::order_status[])
          AND o.service_zone_id IS NOT NULL
          AND ($1::uuid IS NULL OR s.category_id = $1)
          AND ($2::uuid IS NULL OR o.service_zone_id = $2)
        GROUP BY o.service_zone_id, s.category_id
      ),
      pairs AS (
        SELECT service_zone_id, category_id FROM supply
        UNION
        SELECT service_zone_id, category_id FROM demand
      )
      SELECT p.service_zone_id, sz.name_ar AS zone_name, p.category_id, sc.name_ar AS category_name,
        COALESCE(s.technicians_total, 0) AS technicians_total,
        COALESCE(s.technicians_light, 0) AS technicians_light,
        COALESCE(s.technicians_meaningful, 0) AS technicians_meaningful,
        COALESCE(s.technicians_heavy, 0) AS technicians_heavy,
        COALESCE(s.technicians_blocked, 0) AS technicians_blocked,
        COALESCE(d.dispatch_pending_count, 0) AS dispatch_pending_count,
        COUNT(*) OVER() AS total_count
      FROM pairs p
      JOIN service_zones sz ON sz.id = p.service_zone_id
      JOIN service_categories sc ON sc.id = p.category_id
      LEFT JOIN supply s ON s.service_zone_id = p.service_zone_id AND s.category_id = p.category_id
      LEFT JOIN demand d ON d.service_zone_id = p.service_zone_id AND d.category_id = p.category_id
      ORDER BY (COALESCE(s.technicians_light, 0) + COALESCE(s.technicians_meaningful, 0)) ASC,
               COALESCE(d.dispatch_pending_count, 0) DESC,
               sz.name_ar ASC, sc.name_ar ASC
      LIMIT $8 OFFSET $9
      `,
      [
        categoryId,
        zoneId,
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        dailyCapacityMinutes,
        GENERIC_SERVICE_DURATION_MINUTES,
        DISPATCH_PENDING_STATUSES,
        filters.perPage,
        offset,
      ],
    );

    const total = rawRows.length > 0 ? Number(rawRows[0].total_count) : 0;
    const items: CoverageRow[] = rawRows.map((r) => {
      const light = Number(r.technicians_light);
      const meaningful = Number(r.technicians_meaningful);
      const pending = Number(r.dispatch_pending_count);
      const available = light + meaningful;
      const coverageStatus: CoverageStatus = pending > 0 && available === 0 ? 'critical' : pending > available ? 'tight' : 'healthy';
      return {
        zoneId: r.service_zone_id,
        zoneName: r.zone_name,
        categoryId: r.category_id,
        categoryName: r.category_name,
        techniciansTotal: Number(r.technicians_total),
        techniciansLight: light,
        techniciansMeaningful: meaningful,
        techniciansHeavy: Number(r.technicians_heavy),
        techniciansBlocked: Number(r.technicians_blocked),
        dispatchPendingCount: pending,
        coverageStatus,
      };
    });

    return { items, meta: { page: filters.page, perPage: filters.perPage, total } };
  }
}
