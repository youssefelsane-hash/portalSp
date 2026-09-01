import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OrderStatus } from '../orders/entities/order.entity';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import { ESCALATABLE_STATUSES } from '../orders/crew-shortage-escalation.service';
import { SettingsService } from '../settings/settings.service';
import { RealtimeSessionRegistry } from '../../common/websocket/realtime-session-registry.service';
import { resolveDailyCapacityMinutes } from '../technicians/technician-day-capacity.sql';

// نفس افتراض describeTechnicianCapacity() لمعاينة تشخيصية عامة (مفيش طلب مرشّح فعلي هنا) —
// technician-eligibility.sql.ts:258.
const GENERIC_SERVICE_DURATION_MINUTES = 60;

// الحالات اللي الطلب فيها "لسه محتاج فني يتوزّع عليه" (docs/08 §36.2) — نفس الحالتين اللي
// findEligibleTechnicians/dispatchNextRound بيحاولوا يقفلوهم، مُعاد استخدامهم هنا كمؤشر عملياتي بس.
// مُصدَّرة (مش local بس) عشان AdminCoverageIntelligenceService (§36.10) تعيد استخدامها بالحرف —
// نفس تعريف "طلب لسه بيدوّر على فني" لازم يفضل واحد.
export const DISPATCH_PENDING_STATUSES = [OrderStatus.SEARCHING_TECHNICIAN, OrderStatus.AWAITING_TECHNICIAN_RESELECTION];

export interface OperationsOverview {
  dispatchPendingCount: number;
  crewShortageOpenCount: number;
  techniciansOnlineCount: number;
  capacityToday: { light: number; meaningful: number; heavy: number; blocked: number };
}

/**
 * نظرة عامة تشغيلية للأدمن (docs/08 §36.2، بداية "مركز العمليات" الجديد) — "بنية الصفحة الأساسية"
 * اللي §36.3 فصاعدًا هتبني عليها (مصفوفة قوى عاملة، مفتّش مطابقة، تايم لاين، تنبيهات...). صفر منطق
 * جديد مُخترَع هنا — كل رقم معاد استخدامه من مصدر حقيقة موجود فعلاً:
 *  - `DISPATCH_PENDING_STATUSES`/`ESCALATABLE_STATUSES` (§35.5) لعدّ الطلبات المحتاجة تصرّف.
 *  - نفس شروط `classifyTechnicianCapacity()` (§34.1، technician-eligibility.sql.ts) بس كـbulk
 *    aggregate مرة واحدة بدل نداء لكل فني على حدة (نفس أسلوب §35.8's `explainOrderFunnel` تمامًا —
 *    "avoid expensive synchronous diagnostics at scale").
 *  - `RealtimeSessionRegistry.onlineUserIds()` (§35.10) للأونلاين، بلا أي جدول حالة جديد.
 * استعلام واحد بـCTEs — صفر N+1، صفر full-table scan غير مجمّع.
 */
@Injectable()
export class AdminOperationsOverviewService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    private readonly realtimeSessions: RealtimeSessionRegistry,
  ) {}

  async getOverview(filters: { categoryId?: string | null }): Promise<OperationsOverview> {
    const categoryId = filters.categoryId ?? null;
    const dailyCapacityMinutes = await resolveDailyCapacityMinutes(this.settingsService);
    const onlineUserIds = this.realtimeSessions.onlineUserIds();

    const [row] = await this.dataSource.query<
      {
        dispatch_pending_count: string;
        crew_shortage_open_count: string;
        online_count: string;
        light_count: string;
        meaningful_count: string;
        heavy_count: string;
        blocked_count: string;
      }[]
    >(
      `
      WITH target AS (
        SELECT (now() AT TIME ZONE 'Africa/Cairo')::date AS target_date
      ),
      dispatch_pending AS (
        SELECT COUNT(*) AS cnt
        FROM orders o
        JOIN services s ON s.id = o.service_id
        WHERE o.deleted_at IS NULL
          AND o.order_status = ANY($1::order_status[])
          AND ($2::uuid IS NULL OR s.category_id = $2::uuid)
      ),
      crew_shortage_open AS (
        SELECT COUNT(*) AS cnt
        FROM orders o
        JOIN services s ON s.id = o.service_id
        WHERE o.deleted_at IS NULL
          AND o.crew_shortage_escalated_at IS NOT NULL
          AND o.order_status = ANY($3::order_status[])
          AND ($2::uuid IS NULL OR s.category_id = $2::uuid)
      ),
      pool AS (
        SELECT tp.id, tp.user_id
        FROM technician_profiles tp
        WHERE tp.deleted_at IS NULL AND tp.verification_status = 'approved'
          AND (
            $2::uuid IS NULL
            OR EXISTS (
              SELECT 1 FROM technician_categories tc
              WHERE tc.technician_id = tp.id AND tc.category_id = $2::uuid
                AND tc.is_active = true AND tc.verification_status = 'approved'
            )
          )
      ),
      classified AS (
        SELECT p.id,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM technician_schedule_slots tss, target
              WHERE tss.technician_id = p.id AND tss.status = 'blocked' AND tss.deleted_at IS NULL
                AND tss.slot_date = target.target_date
            ) THEN 'BLOCKED'
            WHEN EXISTS (
              SELECT 1 FROM orders co
              JOIN services cs ON cs.id = co.service_id, target
              WHERE co.technician_id = p.id AND co.order_status = ANY($4::order_status[]) AND co.deleted_at IS NULL
                AND (COALESCE(co.scheduled_at, now()) AT TIME ZONE 'Africa/Cairo')::date = target.target_date
                AND (
                  co.order_status = ANY($5::order_status[])
                  OR COALESCE(co.estimated_duration_days, 0) >= 1
                  OR COALESCE(cs.estimated_duration_minutes, 60) >= $6::int
                  OR $7::int >= $6::int
                )
            ) THEN 'HEAVY'
            WHEN EXISTS (
              SELECT 1 FROM orders co, target
              WHERE co.technician_id = p.id AND co.order_status = ANY($4::order_status[]) AND co.deleted_at IS NULL
                AND (COALESCE(co.scheduled_at, now()) AT TIME ZONE 'Africa/Cairo')::date = target.target_date
            ) THEN 'MEANINGFUL'
            ELSE 'LIGHT'
          END AS tier
        FROM pool p
      )
      SELECT
        (SELECT cnt FROM dispatch_pending) AS dispatch_pending_count,
        (SELECT cnt FROM crew_shortage_open) AS crew_shortage_open_count,
        (SELECT COUNT(*) FROM pool WHERE user_id = ANY($8::uuid[])) AS online_count,
        (SELECT COUNT(*) FROM classified WHERE tier = 'LIGHT') AS light_count,
        (SELECT COUNT(*) FROM classified WHERE tier = 'MEANINGFUL') AS meaningful_count,
        (SELECT COUNT(*) FROM classified WHERE tier = 'HEAVY') AS heavy_count,
        (SELECT COUNT(*) FROM classified WHERE tier = 'BLOCKED') AS blocked_count
      `,
      [
        DISPATCH_PENDING_STATUSES,
        categoryId,
        ESCALATABLE_STATUSES,
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        dailyCapacityMinutes,
        GENERIC_SERVICE_DURATION_MINUTES,
        onlineUserIds,
      ],
    );

    return {
      dispatchPendingCount: Number(row.dispatch_pending_count),
      crewShortageOpenCount: Number(row.crew_shortage_open_count),
      techniciansOnlineCount: Number(row.online_count),
      capacityToday: {
        light: Number(row.light_count),
        meaningful: Number(row.meaningful_count),
        heavy: Number(row.heavy_count),
        blocked: Number(row.blocked_count),
      },
    };
  }
}
