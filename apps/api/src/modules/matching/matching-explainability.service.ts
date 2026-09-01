import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import { BookingMode, Order, OrderStatus } from '../orders/entities/order.entity';
// دالة نقية (صفر DI) — استيرادها هنا مباشر بلا خطر cycle، بعكس OrderTeamService (Injectable
// كامل)، اللي حقنه هنا كان هيفرض MatchingModule تستورد OrdersModule وترجّع نفس بَقّة ترتيب الـroutes
// الموثّقة في matching.module.ts (Orders→Matching اتجاه واحد بس، ده السبب).
import { computeCrewComposition, CrewComposition } from '../orders/order-team.service';
import { SettingsService } from '../settings/settings.service';
import {
  classifyTechnicianCapacity,
  technicianAvailabilityCondition,
  TechnicianCapacityTier,
  technicianServiceQualificationCondition,
} from '../technicians/technician-eligibility.sql';
import { MatchingService } from './matching.service';
import { resolveDailyCapacityMinutes } from '../technicians/technician-day-capacity.sql';

// batchSize كبير عمدًا (docs/08 §36.6) — عشان findEligibleTechnicians() ترجّع كل المجمّع المؤهّل
// الحقيقي (مش أول N بس) وقت حساب ترتيب/rank_score فني معيّن للتفسير. صفر تأثير على مسار المطابقة
// الفعلي — نداء تشخيصي منفصل تمامًا (قراءة بس).
const EXPLAIN_RANKING_BATCH_SIZE = 10_000;


export interface TechnicianEligibilityCheck {
  key: string;
  passed: boolean;
  labelAr: string;
}

export interface TechnicianRankScoreBreakdown {
  /** جودة — technician_level_config.order_priority_weight بتاع مستوى الفني. */
  priorityComponent: number;
  /** قدرة — خصم الحِمل الحالي (سالب، already-negated). */
  workloadPenalty: number;
  /** عدالة — خصم "توزيع حديث" (سالب، already-negated). */
  fairnessPenalty: number;
  /** موثوقية (docs/08 §36.20-21، ADR-0023) — تعديل مبني على تقييم الفني، صفر لو تقييماته أقل من الحد الأدنى. */
  reliabilityAdjustment: number;
  /** أفضلية شركة مسجلة وقادرة على تغطية طاقم طلب كبير؛ صفر لكل الحالات الأخرى. */
  companyAdjustment: number;
}

export interface TechnicianRankInfo {
  /** rank_score الحقيقي (نفس صيغة findEligibleTechnicians() بالحرف) — أعلى = أولوية أكبر. */
  rankScore: number;
  /** ترتيب الفني ده بين كل المرشّحين المؤهّلين فعليًا لنفس الطلب دلوقتي (1 = الأعلى أولوية). */
  rank: number;
  /** إجمالي عدد المرشّحين المؤهّلين فعليًا (نفس المجمّع اللي findEligibleTechnicians() هترجّعه). */
  totalEligible: number;
  /** تفكيك rank_score لمكوّناته الأربعة — نفس الأرقام الخام من الاستعلام، صفر حساب مكرر هنا. */
  scoreBreakdown: TechnicianRankScoreBreakdown;
}

export interface TechnicianEligibilityExplanation {
  technicianId: string;
  orderId: string;
  eligible: boolean;
  /** أول سبب استبعاد حقيقي (أول check فاشل بترتيب findEligibleTechnicians())، أو نص "مؤهّل" لو eligible=true. */
  reasonAr: string;
  checks: TechnicianEligibilityCheck[];
  capacityTier: TechnicianCapacityTier | null;
  distanceKm: string | null;
  /** null لو الفني مش ضمن المجمّع المؤهّل الحقيقي فعليًا (findEligibleTechnicians() ماترجّعوش) —
   * غالبًا نفس سبب eligible=false فوق، أو order.requestedTechnicianId مضبوط لفني تاني (docs/08 §36.6). */
  rankInfo: TechnicianRankInfo | null;
}

interface EligibilityRow {
  verified: boolean;
  category_eligible: boolean;
  zone_eligible: boolean;
  has_location: boolean;
  not_already_offered: boolean;
  matches_requested_technician: boolean;
  matches_preferred_company: boolean;
  availability_ok: boolean;
  decision_limit_ok: boolean;
  team_leader_ok: boolean;
  distance_km: string | null;
}

/**
 * تفسير مطابقة (docs/08 §35.7، ADR-0021 §4) — "ليه الفني ده مش بياخد الطلب ده؟" بإجابة بتستهلك
 * **نفس** الشروط الحقيقية اللي `MatchingService.findEligibleTechnicians()` بيفلتر بيها فعليًا
 * (نفس ترتيب WHERE clauses بالحرف)، صفر خوارزمية تشخيصية موازية مخترعة في الفرونت-إند — طلب
 * المالك صراحة ومكرر مرتين في §35 (تحذير من "لوحة أدمن بتخترع تفسير بديل"). كل check هنا بيتحسب
 * كعمود منفصل في استعلام واحد (مش N round-trips)، وبيتقيّموا **كلهم** (مش short-circuit) عشان
 * الأدمن يشوف الصورة الكاملة لو فيه أكتر من سبب استبعاد مع بعض.
 *
 * **إعادة استخدام حرفية**: `technicianAvailabilityCondition()` نفسها (نفس الدالة المستخدمة في
 * matching.service.ts/technicians.service.ts/technician-assignment-guard.service.ts) بتتلف هنا
 * جوّه `EXISTS` مترابط بدل ما تُستخدم كـWHERE مباشر — بيرجّع نفس النتيجة البوليانية بالظبط بلا أي
 * تكرار منطق. `classifyTechnicianCapacity()` كمان نفس الدالة المستخدمة في autoConfirmScheduledOrder().
 *
 * فحص "فئة/خدمة" (`category_eligible`) هو استثناء وحيد — SQL منسوخ حرفيًا (LEFT JOIN
 * technician_services + EXISTS technician_categories) من نفس الشرط في findEligibleTechnicians()،
 * مش دالة مشتركة مستخرجة (الشرط ده مكرر أصلاً بلا دالة مشتركة في matching.service.ts/
 * technicians.service.ts من قبل هذه الميزة — استخراجه لدالة مشتركة فعليًا يستدعي تعديل ملفين
 * شغالين ومُختبرين، خارج نطاق §35.7).
 */
@Injectable()
export class MatchingExplainabilityService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    private readonly matchingService: MatchingService,
  ) {}

  async explainTechnicianForOrder(order: Order, technicianId: string): Promise<TechnicianEligibilityExplanation> {
    if (!order.serviceZoneId) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب ده مالوش نطاق خدمة محدد — مفيش مطابقة ممكنة عليه أصلاً', HttpStatus.BAD_REQUEST);
    }

    const dailyCapacityMinutes = await resolveDailyCapacityMinutes(this.settingsService);
    const isEmergency = order.bookingMode === BookingMode.EMERGENCY;

    const [row] = await this.dataSource.query<EligibilityRow[]>(
      `
      SELECT
        (tp.verification_status = 'approved') AS verified,
        (${technicianServiceQualificationCondition({
          technicianIdExpr: 'tp.id',
          serviceIdExpr: 's.id',
          categoryIdExpr: 's.category_id',
          directServiceAlias: 'ts',
        })}) AS category_eligible,
        EXISTS (
          SELECT 1 FROM technician_zones tz WHERE tz.technician_id = tp.id AND tz.service_zone_id = $2 AND tz.is_active = true
        ) AS zone_eligible,
        (tp.current_location IS NOT NULL) AS has_location,
        NOT EXISTS (
          SELECT 1 FROM order_assignments oa WHERE oa.order_id = $4 AND oa.technician_id = tp.id
        ) AS not_already_offered,
        ($7::uuid IS NULL OR tp.id = $7) AS matches_requested_technician,
        ($8::uuid IS NULL OR tp.company_id = $8) AS matches_preferred_company,
        EXISTS (
          SELECT 1 FROM technician_profiles tp2
          WHERE tp2.id = tp.id
          ${technicianAvailabilityCondition({
            technicianIdExpr: 'tp2.id',
            scheduledAtParam: '$9',
            excludeOrderIdParam: '$4',
            activeStatusesParam: '$6',
            engagedStatusesParam: '$10',
            isEmergencyParam: '$11',
            serviceDurationExpr: "COALESCE((SELECT COALESCE(o2.duration_minutes, o2.duration_hours * 60) FROM orders o2 WHERE o2.id = $4::uuid), COALESCE(s.estimated_duration_minutes, 60), 60)",
            candidateSpanDaysExpr: "GREATEST(COALESCE(CEIL((SELECT o3.estimated_duration_days FROM orders o3 WHERE o3.id = $4::uuid))::int, 1), 1)",
            dailyCapacityMinutesParam: '$12',
          })}
        ) AS availability_ok,
        -- docs/08 §36.6 — نفس شرط findEligibleTechnicians()/assertCoreEligibility() بالحرف
        -- (decision_limit_cents) كان ناقص من قايمة checks هنا رغم إضافته لاكتشاف/تأكيد المطابقة
        -- الفعليين (§36.1 تعميق) — فجوة حقيقية كانت ممكن تخلي التفسير يقول "مؤهّل" لفني محرك
        -- المطابقة الحقيقي هيرفضه فعليًا وقت التأكيد.
        EXISTS (
          SELECT 1 FROM technician_level_config dlc
          WHERE dlc.level = tp.current_level
            AND (dlc.decision_limit_cents IS NULL OR dlc.decision_limit_cents >= $13::int)
        ) AS decision_limit_ok,
        -- docs/08 §107 — الشرط ده كان **ناقص من قايمة الـchecks** رغم إنه مفروض فعليًا في
        -- assertCoreEligibility() وفي listForServiceBooking(isTeamBooking=true). النتيجة كانت
        -- تناقض حقيقي اتلقط حي: المفتّش بيقول «مؤهّل بالكامل» لشخص مستواه verified بينما
        -- قايمة التعيين الإجباري مش بتعرضه أصلاً والتنفيذ هيرفضه بـ409. بيتفحص بس لما الطلب
        -- طلب اعتماد فعلاً — أي وضع تاني بيعدّي true زي ما التنفيذ بيعمل بالظبط.
        ($14::boolean IS NOT TRUE OR EXISTS (
          SELECT 1 FROM technician_level_config tbc
          WHERE tbc.level = tp.current_level AND tbc.eligible_for_team_booking = true
        )) AS team_leader_ok,
        (ST_Distance(tp.current_location, a.location) / 1000.0)::text AS distance_km
      FROM technician_profiles tp
      LEFT JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = $1 AND ts.is_active = true
        AND ts.verification_status = 'approved'
      JOIN services s ON s.id = $1
      JOIN addresses a ON a.id = $3
      WHERE tp.id = $5 AND tp.deleted_at IS NULL
      `,
      [
        order.serviceId,
        order.serviceZoneId,
        order.addressId,
        order.id,
        technicianId,
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        order.requestedTechnicianId,
        order.requestedTechnicianCompanyId,
        order.scheduledAt,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        isEmergency,
        dailyCapacityMinutes,
        order.totalAmountCents,
        order.bookingMode === BookingMode.TEAM,
      ],
    );

    if (!row) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني غير موجود', HttpStatus.NOT_FOUND);
    }

    const checks: TechnicianEligibilityCheck[] = [
      { key: 'verified', passed: row.verified, labelAr: 'الفني معتمد (verification_status=approved)' },
      { key: 'category_eligible', passed: row.category_eligible, labelAr: 'مؤهّل لفئة/خدمة الطلب' },
      { key: 'zone_eligible', passed: row.zone_eligible, labelAr: 'مفعّل في نطاق خدمة الطلب' },
      { key: 'has_location', passed: row.has_location, labelAr: 'عنده موقع GPS مسجّل حاليًا' },
      {
        key: 'not_already_offered',
        passed: row.not_already_offered,
        labelAr: row.not_already_offered
          ? 'لم تُرسل نفس الفرصة لهذا الفني من قبل'
          : 'سبق إرسال نفس الطلب لهذا الفني؛ لن نكرر الإشعار، ويمكن تجربة فني آخر',
      },
      {
        key: 'matches_requested_technician',
        passed: row.matches_requested_technician,
        labelAr: row.matches_requested_technician
          ? 'يطابق الفني المحدد للطلب، أو الطلب مفتوح لأي فني'
          : 'الطلب مقيّد بفني آخر؛ أزل اختيار الفني المحدد لتشغيل المطابقة على الجميع',
      },
      { key: 'matches_preferred_company', passed: row.matches_preferred_company, labelAr: 'يطابق الشركة/الفريق المطلوب (اعتماد، لو مطلوب)' },
      { key: 'availability_ok', passed: row.availability_ok, labelAr: 'متاح وقت الطلب (بلا تعارض جدول/حظر يوم)' },
      { key: 'decision_limit_ok', passed: row.decision_limit_ok, labelAr: 'حد قرار مستوى الفني يكفي قيمة الطلب' },
      {
        key: 'team_leader_ok',
        passed: row.team_leader_ok,
        labelAr: row.team_leader_ok
          ? 'مستواه مؤهّل لقيادة الطلب (طلب اعتماد)'
          : 'مستوى الشخص ده مش مؤهّل يبقى قائد مهمة اعتماد — يقدر ينضم للطاقم كعضو، مش يقوده',
      },
    ];

    const firstFailure = checks.find((c) => !c.passed);
    const eligible = !firstFailure;

    let capacityTier: TechnicianCapacityTier | null = null;
    try {
      const [service] = await this.dataSource.query<{ estimated_duration_minutes: number | null }[]>(
        `SELECT estimated_duration_minutes FROM services WHERE id = $1`,
        [order.serviceId],
      );
      capacityTier = await classifyTechnicianCapacity(this.dataSource, {
        technicianId,
        scheduledAt: order.scheduledAt,
        excludeOrderId: order.id,
        serviceDurationMinutes: service?.estimated_duration_minutes ?? 60,
        dailyCapacityMinutes: dailyCapacityMinutes,
      });
    } catch {
      capacityTier = null;
    }

    const reasonAr = eligible ? 'مؤهّل بالكامل لمطابقة هذا الطلب دلوقتي' : `مش مؤهّل — ${firstFailure!.labelAr} (فشل)`;

    // docs/08 §36.6 — ترتيب/rank_score حقيقي بين المرشّحين المؤهّلين فعليًا، مُعاد استخدامه بالحرف
    // من findEligibleTechnicians() (نفس صيغة order_priority_weight/workload/fairness)، صفر صيغة
    // ترتيب موازية مخترعة هنا. batchSize كبير عشان يرجّع المجمّع كامل مش أول N بس.
    let rankInfo: TechnicianRankInfo | null = null;
    try {
      const rankedCandidates = await this.matchingService.findEligibleTechnicians(
        order,
        EXPLAIN_RANKING_BATCH_SIZE,
        order.requestedTechnicianId,
        false,
        order.requestedTechnicianCompanyId,
      );
      const idx = rankedCandidates.findIndex((c) => c.technician_id === technicianId);
      if (idx !== -1) {
        const row = rankedCandidates[idx];
        rankInfo = {
          rankScore: Number(row.rank_score),
          rank: idx + 1,
          totalEligible: rankedCandidates.length,
          scoreBreakdown: {
            priorityComponent: Number(row.priority_component),
            workloadPenalty: Number(row.workload_penalty),
            fairnessPenalty: Number(row.fairness_penalty),
            reliabilityAdjustment: Number(row.reliability_adjustment),
            companyAdjustment: Number(row.company_adjustment),
          },
        };
      }
    } catch {
      rankInfo = null;
    }

    return {
      technicianId,
      orderId: order.id,
      eligible,
      reasonAr,
      checks,
      capacityTier,
      distanceKm: row.distance_km,
      rankInfo,
    };
  }

  /**
   * فانل مطابقة الطلب (docs/08 §35.8، ADR-0021 §4) — "ليه الطلب ده لسه بيدوّر؟" بمراحل حقيقية
   * مطابقة للترتيب اللي المالك طلبه بالحرف: category-eligible → zone-passed → blocked → free/
   * meaningful/heavy split → opportunities sent/declined/pending → crew shortage. صفر رقم
   * مُلفَّق — كل عدد هنا بيتحسب من نفس شروط `findEligibleTechnicians()`/`classifyTechnicianCapacity()`
   * (تصنيف الطاقم الأربعة كامل هنا، مش بس LIGHT/MEANINGFUL زي `explainTechnicianForOrder()` —
   * BLOCKED/HEAVY مُستبعدين فعليًا من `findEligibleTechnicians()` لكن لسه مفيدين للأدمن يشوفهم
   * كسبب "ليه العدد قليل"، مش مجرد صفر بلا تفسير) — استعلام واحد لكل الفانل الأساسي (مش N فني
   * منفصل، عشان الأداء مع مجمّعات كبيرة زي طلب المالك "avoid expensive synchronous diagnostics").
   */
  async explainOrderFunnel(order: Order): Promise<OrderMatchingFunnel> {
    if (!order.serviceZoneId) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب ده مالوش نطاق خدمة محدد — مفيش فانل مطابقة ممكن عليه أصلاً', HttpStatus.BAD_REQUEST);
    }

    const dailyCapacityMinutes = await resolveDailyCapacityMinutes(this.settingsService);
    const [service] = await this.dataSource.query<{ estimated_duration_minutes: number | null }[]>(
      `SELECT estimated_duration_minutes FROM services WHERE id = $1`,
      [order.serviceId],
    );
    const serviceDurationMinutes = service?.estimated_duration_minutes ?? 60;

    const [poolRow] = await this.dataSource.query<
      { category_eligible_count: string; zone_eligible_count: string; blocked_count: string; heavy_count: string; meaningful_count: string; light_count: string }[]
    >(
      `
      WITH target AS (
        SELECT (COALESCE($3::timestamptz, now()) AT TIME ZONE 'Africa/Cairo')::date AS target_date
      ),
      pool AS (
        SELECT tp.id
        FROM technician_profiles tp
        LEFT JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = $1 AND ts.is_active = true
          AND ts.verification_status = 'approved'
        JOIN services s ON s.id = $1
        WHERE tp.deleted_at IS NULL AND tp.verification_status = 'approved'
          AND ${technicianServiceQualificationCondition({
            technicianIdExpr: 'tp.id',
            serviceIdExpr: 's.id',
            categoryIdExpr: 's.category_id',
            directServiceAlias: 'ts',
          })}
      ),
      zone_pool AS (
        SELECT p.id FROM pool p
        WHERE EXISTS (SELECT 1 FROM technician_zones tz WHERE tz.technician_id = p.id AND tz.service_zone_id = $2 AND tz.is_active = true)
      ),
      classified AS (
        SELECT z.id,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM technician_schedule_slots tss, target
              WHERE tss.technician_id = z.id AND tss.status = 'blocked' AND tss.deleted_at IS NULL
                AND tss.slot_date = target.target_date
                AND tss.start_time < ((COALESCE($3::timestamptz, now()) AT TIME ZONE 'Africa/Cairo')
                      + ($6::int || ' minutes')::interval)::time
                AND tss.end_time > (COALESCE($3::timestamptz, now()) AT TIME ZONE 'Africa/Cairo')::time
            ) THEN 'BLOCKED'
            WHEN EXISTS (
              SELECT 1 FROM orders co JOIN services cs ON cs.id = co.service_id, target
              WHERE co.technician_id = z.id AND co.id IS DISTINCT FROM $4::uuid
                AND co.order_status = ANY($7::order_status[]) AND co.deleted_at IS NULL
                AND (COALESCE(co.scheduled_at, now()) AT TIME ZONE 'Africa/Cairo')::date = target.target_date
                AND (
                  (
                    target.target_date = (now() AT TIME ZONE 'Africa/Cairo')::date
                    AND co.order_status = ANY($8::order_status[])
                  )
                  OR COALESCE(co.estimated_duration_days, 0) >= 1
                  OR COALESCE(cs.estimated_duration_minutes, 60) >= $5::int
                  OR $6::int >= $5::int
                )
            ) THEN 'HEAVY'
            WHEN EXISTS (
              SELECT 1 FROM orders co, target
              WHERE co.technician_id = z.id AND co.id IS DISTINCT FROM $4::uuid
                AND co.order_status = ANY($7::order_status[]) AND co.deleted_at IS NULL
                AND (COALESCE(co.scheduled_at, now()) AT TIME ZONE 'Africa/Cairo')::date = target.target_date
            ) THEN 'MEANINGFUL'
            ELSE 'LIGHT'
          END AS tier
        FROM zone_pool z
      )
      SELECT
        (SELECT COUNT(*) FROM pool) AS category_eligible_count,
        (SELECT COUNT(*) FROM zone_pool) AS zone_eligible_count,
        COUNT(*) FILTER (WHERE tier = 'BLOCKED') AS blocked_count,
        COUNT(*) FILTER (WHERE tier = 'HEAVY') AS heavy_count,
        COUNT(*) FILTER (WHERE tier = 'MEANINGFUL') AS meaningful_count,
        COUNT(*) FILTER (WHERE tier = 'LIGHT') AS light_count
      FROM classified
      `,
      [
        order.serviceId,
        order.serviceZoneId,
        order.scheduledAt,
        order.id,
        dailyCapacityMinutes,
        serviceDurationMinutes,
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
      ],
    );

    const assignmentRows = await this.dataSource.query<{ assignment_status: string; count: string }[]>(
      `SELECT assignment_status, COUNT(*) AS count FROM order_assignments WHERE order_id = $1 GROUP BY assignment_status`,
      [order.id],
    );
    const dispatchAssignments: OrderAssignmentStatusCounts = { sent: 0, viewed: 0, accepted: 0, rejected: 0, timeout: 0, cancelled: 0 };
    for (const row of assignmentRows) {
      if (row.assignment_status in dispatchAssignments) {
        (dispatchAssignments as unknown as Record<string, number>)[row.assignment_status] = Number(row.count);
      }
    }

    let crewRecruitOpportunities: WorkOpportunityStatusCounts | null = null;
    let crewStatus: CrewComposition | null = null;
    if (order.bookingMode === BookingMode.TEAM) {
      const opportunityRows = await this.dataSource.query<{ status: string; count: string }[]>(
        `SELECT status, COUNT(*) AS count FROM technician_work_opportunities
         WHERE order_id = $1 AND context = 'crew_recruit' AND deleted_at IS NULL GROUP BY status`,
        [order.id],
      );
      crewRecruitOpportunities = { offered: 0, accepted: 0, declined: 0, closed: 0 };
      for (const row of opportunityRows) {
        if (row.status in crewRecruitOpportunities) {
          (crewRecruitOpportunities as unknown as Record<string, number>)[row.status] = Number(row.count);
        }
      }

      const teamRows = await this.dataSource.query<{ member_type: string; count: string }[]>(
        `SELECT member_type, COUNT(*) AS count FROM order_team_members WHERE order_id = $1 GROUP BY member_type`,
        [order.id],
      );
      const technicians = Number(teamRows.find((r) => r.member_type === 'team_member')?.count ?? 0);
      const assistants = Number(teamRows.find((r) => r.member_type === 'assistant')?.count ?? 0);
      crewStatus = computeCrewComposition(order.requiredTechnicians, order.requiredAssistants, { technicians, assistants });
    }

    return {
      orderId: order.id,
      orderStatus: order.orderStatus,
      pool: {
        categoryEligible: Number(poolRow?.category_eligible_count ?? 0),
        zoneEligible: Number(poolRow?.zone_eligible_count ?? 0),
        blocked: Number(poolRow?.blocked_count ?? 0),
        heavy: Number(poolRow?.heavy_count ?? 0),
        meaningful: Number(poolRow?.meaningful_count ?? 0),
        light: Number(poolRow?.light_count ?? 0),
      },
      dispatchAssignments,
      crewRecruitOpportunities,
      crewStatus,
    };
  }
}

export interface OrderMatchingFunnelPoolCounts {
  categoryEligible: number;
  zoneEligible: number;
  blocked: number;
  heavy: number;
  meaningful: number;
  /** المرشّحين الفعليين لتعيين/تأكيد تلقائي دلوقتي — نفس الفنيين اللي findEligibleTechnicians() هترجّعهم. */
  light: number;
}

export interface OrderAssignmentStatusCounts {
  sent: number;
  viewed: number;
  accepted: number;
  rejected: number;
  timeout: number;
  cancelled: number;
}

export interface WorkOpportunityStatusCounts {
  offered: number;
  accepted: number;
  declined: number;
  closed: number;
}

export interface OrderMatchingFunnel {
  orderId: string;
  orderStatus: OrderStatus;
  pool: OrderMatchingFunnelPoolCounts;
  /** توزيع order_assignments (مسار التوزيع العادي/الطوارئ) — سواء اتبعت للطلب فعليًا لحد دلوقتي. */
  dispatchAssignments: OrderAssignmentStatusCounts;
  /** null لطلبات فردية/طوارئ — بس لطلبات الفريق (technician_work_opportunities، context='crew_recruit'). */
  crewRecruitOpportunities: WorkOpportunityStatusCounts | null;
  /** null لطلبات فردية/طوارئ. */
  crewStatus: CrewComposition | null;
}
