import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import { SettingsService } from '../settings/settings.service';
import { TechnicianCapacityTier } from '../technicians/technician-eligibility.sql';
import { TechnicianLevel } from '../technicians/entities/technician-profile.entity';
import { resolveDailyCapacityMinutes } from '../technicians/technician-day-capacity.sql';

// نفس افتراض describeTechnicianCapacity()/capacity_today (§36.2) — مفيش طلب مرشّح فعلي هنا،
// معاينة عامة بس (technician-eligibility.sql.ts:258).
const GENERIC_SERVICE_DURATION_MINUTES = 60;
const FORECAST_DAYS = 7;

export interface WorkloadForecastFilters {
  categoryId: string;
  zoneId?: string | null;
  page: number;
  perPage: number;
}

export interface WorkloadForecastDay {
  date: string;
  tier: TechnicianCapacityTier;
  isMultiDay: boolean;
}

export interface WorkloadForecastRow {
  id: string;
  technicianCode: string;
  fullName: string;
  currentLevel: TechnicianLevel;
  days: WorkloadForecastDay[];
}

interface RawDay {
  date: string;
  tier: TechnicianCapacityTier;
  is_multi_day: boolean;
}

interface RawRow {
  id: string;
  technician_code: string;
  full_name: string;
  current_level: TechnicianLevel;
  total_count: string;
  days: RawDay[];
}

/**
 * عرض الحمل القريب — 7 أيام (docs/08 §36.4). **صفر خوارزمية تصنيف موازية جديدة**: كل يوم من الـ7
 * بيتصنّف بنفس شروط `classifyTechnicianCapacity()` بالحرف (نفس أولوية BLOCKED > HEAVY > MEANINGFUL
 * > LIGHT)، بس كـbulk aggregate (استعلام واحد بـCROSS JOIN مع سلسلة تواريخ) بدل نداء منفصل لكل
 * (فني، يوم) — نفس أسلوب `capacity_today` في §36.2 وaggregate الفئة في §35.9.
 *
 * **اكتشاف مهم اتلقطناه وقت البناء، لازم يتوثّق صراحة مش يتصلّح ضمنيًا هنا**: تصنيف HEAVY الحالي
 * (`technician-eligibility.sql.ts`) بيفحص بس إن `co.scheduled_at::date = target_date` — يعني طلب
 * "استغرق يومين" (`estimated_duration_days=2`) بيوصّم يومه الأول (`scheduled_at`) بس كـHEAVY/
 * multi-day، **مش اليوم التاني تلقائيًا** (مفيش حالياً أي آلية فعلية في محرك المطابقة بتحسب/تحجز
 * الأيام التالية لشغلانة متعددة الأيام). عرض الحمل ده بيعرض بالظبط نفس اللي محرك المطابقة الحقيقي
 * "بيقرر" — لو اليوم التاني مش محسوب busy فعليًا في القرارات الحقيقية، الشاشة دي المفروض تعكس ده
 * بالضبط ("one source of truth" — مفيش نسخة تانية من الواقع). ده جزئيًا يفسّر ليه علامة "متعدد
 * الأيام" هنا معروضة بس على يوم البداية (`isMultiDay`) — تنبيه بصري إن الشغلانة دي متوقّع تاخد أكتر
 * من يوم، مش ادّعاء إن الأيام التالية محجوزة فعليًا في محرك المطابقة الحالي. لو ده سلوك مش مقصود
 * فعليًا، الإصلاح خارج نطاق §36.4 (تعديل معماري في `technician-eligibility.sql.ts` نفسه، مش هنا).
 */
@Injectable()
export class AdminWorkloadForecastService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
  ) {}

  async getForecast(
    filters: WorkloadForecastFilters,
  ): Promise<{ items: WorkloadForecastRow[]; meta: { page: number; perPage: number; total: number } }> {
    const offset = (filters.page - 1) * filters.perPage;
    const dailyCapacityMinutes = await resolveDailyCapacityMinutes(this.settingsService);

    const rawRows = await this.dataSource.query<RawRow[]>(
      `
      WITH RECURSIVE date_series AS (
        SELECT (now() AT TIME ZONE 'Africa/Cairo')::date AS d, 0 AS n
        UNION ALL
        SELECT d + 1, n + 1 FROM date_series WHERE n < $9::int - 1
      ),
      pool AS (
        SELECT tp.id, tp.technician_code, tp.current_level, u.full_name,
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
          AND (
            $2::uuid IS NULL
            OR EXISTS (
              SELECT 1 FROM technician_zones tz
              WHERE tz.technician_id = tp.id AND tz.service_zone_id = $2 AND tz.is_active = true
            )
          )
        ORDER BY u.full_name ASC
        LIMIT $3 OFFSET $4
      ),
      grid AS (
        SELECT p.id AS technician_id, ds.d AS target_date
        FROM pool p CROSS JOIN date_series ds
      ),
      classified AS (
        SELECT g.technician_id, g.target_date,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM technician_schedule_slots tss
              WHERE tss.technician_id = g.technician_id AND tss.status = 'blocked' AND tss.deleted_at IS NULL
                AND tss.slot_date = g.target_date
            ) THEN 'BLOCKED'
            WHEN EXISTS (
              SELECT 1 FROM orders co
              JOIN services cs ON cs.id = co.service_id
              WHERE co.technician_id = g.technician_id AND co.order_status = ANY($5::order_status[]) AND co.deleted_at IS NULL
                AND (COALESCE(co.scheduled_at, now()) AT TIME ZONE 'Africa/Cairo')::date = g.target_date
                AND (
                  (g.target_date = (now() AT TIME ZONE 'Africa/Cairo')::date AND co.order_status = ANY($6::order_status[]))
                  OR COALESCE(co.estimated_duration_days, 0) >= 1
                  OR COALESCE(cs.estimated_duration_minutes, 60) >= $7::int
                  OR $8::int >= $7::int
                )
            ) THEN 'HEAVY'
            WHEN EXISTS (
              SELECT 1 FROM orders co
              WHERE co.technician_id = g.technician_id AND co.order_status = ANY($5::order_status[]) AND co.deleted_at IS NULL
                AND (COALESCE(co.scheduled_at, now()) AT TIME ZONE 'Africa/Cairo')::date = g.target_date
            ) THEN 'MEANINGFUL'
            ELSE 'LIGHT'
          END AS tier,
          EXISTS (
            SELECT 1 FROM orders co
            WHERE co.technician_id = g.technician_id AND co.order_status = ANY($5::order_status[]) AND co.deleted_at IS NULL
              AND (COALESCE(co.scheduled_at, now()) AT TIME ZONE 'Africa/Cairo')::date = g.target_date
              AND COALESCE(co.estimated_duration_days, 0) >= 2
          ) AS is_multi_day
        FROM grid g
      )
      SELECT p.id, p.technician_code, p.current_level, p.full_name, p.total_count,
        json_agg(
          json_build_object('date', TO_CHAR(c.target_date, 'YYYY-MM-DD'), 'tier', c.tier, 'is_multi_day', c.is_multi_day)
          ORDER BY c.target_date
        ) AS days
      FROM pool p
      JOIN classified c ON c.technician_id = p.id
      GROUP BY p.id, p.technician_code, p.current_level, p.full_name, p.total_count
      ORDER BY p.full_name ASC
      `,
      [
        filters.categoryId,
        filters.zoneId ?? null,
        filters.perPage,
        offset,
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        dailyCapacityMinutes,
        GENERIC_SERVICE_DURATION_MINUTES,
        FORECAST_DAYS,
      ],
    );

    const total = rawRows.length > 0 ? Number(rawRows[0].total_count) : 0;
    const items: WorkloadForecastRow[] = rawRows.map((r) => ({
      id: r.id,
      technicianCode: r.technician_code,
      fullName: r.full_name,
      currentLevel: r.current_level,
      days: r.days.map((d) => ({ date: d.date, tier: d.tier, isMultiDay: d.is_multi_day })),
    }));

    return { items, meta: { page: filters.page, perPage: filters.perPage, total } };
  }
}
