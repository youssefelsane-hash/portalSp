import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runExclusiveSweep } from '../../common/db/sweep-lock';
import { NotificationRoutingService } from '../notifications/notification-routing.service';
import { ESCALATABLE_STATUSES } from '../orders/crew-shortage-escalation.service';
import { computeCrewComposition } from '../orders/order-team.service';
import {
  REVISIT_RESPONSE_WINDOW_HOURS_FALLBACK,
  REVISIT_RESPONSE_WINDOW_HOURS_SETTING,
  type RevisitPinExhaustionReason,
} from '../orders/revisit-pin';
import { SettingsService } from '../settings/settings.service';

const EXCEPTION_LIST_LIMIT = 50;
const DEPARTURE_WARNING_MINUTES_FALLBACK = 30;
const ARRIVAL_GRACE_MINUTES_FALLBACK = 20;
const AT_RISK_SWEEP_INTERVAL_MS = 60_000;
export const AT_RISK_ROUTING_EVENT = 'order.appointment_at_risk';

/**
 * **موعد في خطر** (docs/08 §189 بند D-4) — بيتلقط **قبل** ما اليوم يفوت، مش بعده زي `overdueOrders`.
 *
 * | المستوى | الشرط | اللون |
 * |---|---|---|
 * | `watch` | فاضل ≤ `operations.departure_warning_minutes` على الموعد والفني لسه ماتحرّكش | مراقبة (بلا تنبيه) |
 * | `late_departure` | جه الموعد والفني لسه ماتحرّكش | أصفر + تنبيه |
 * | `late_arrival` | عدّى على الموعد `operations.arrival_grace_minutes` والفني لسه ماوصلش (اتحرك أو لأ) | أحمر + تنبيه |
 *
 * مفيش auto-rematch: الموظف بيتصل بالفني والعميل ويستخدم reassign/rematch/reschedule الموجودين.
 */
export type AtRiskLevel = 'watch' | 'late_departure' | 'late_arrival';

export interface AtRiskAppointmentItem {
  orderId: string;
  orderNumber: string;
  scheduledAt: string;
  level: AtRiskLevel;
  orderStatus: string;
  technicianId: string | null;
  technicianCode: string | null;
  fullName: string | null;
  phone: string | null;
  /** موجب = متأخر بالدقايق عن الموعد، سالب = فاضل كام دقيقة. */
  minutesFromAppointment: number;
  moved: boolean;
  departedAt: string | null;
  lastLocationAt: string | null;
  lastActivityAt: string | null;
}

export interface ExceptionCenterFilters {
  categoryId?: string | null;
  zoneId?: string | null;
}

export interface CrewShortageExceptionItem {
  orderId: string;
  orderNumber: string;
  scheduledAt: string;
  escalatedAt: string;
  missingTechnicians: number;
  missingAssistants: number;
  isOverdue: boolean;
}

export interface StaleDispatchExceptionItem {
  assignmentId: string;
  orderId: string;
  /**
   * رقم الطلب المقروء (docs/08 §77-A3، بلاغ مالك). الصف كان بيعرض لينك عام «عرض الطلب» + اسم
   * الفني + الميعاد وبس — موظف العمليات كان مضطر يفتح كل صف عشان يعرف هو بيبص على إيه.
   * الرقم ده هو الحاجة الوحيدة اللي بيتكلم بيها مع العميل والفني، فغيابه هنا بيبطّل القايمة.
   */
  orderNumber: string;
  technicianId: string;
  technicianCode: string;
  fullName: string;
  sentAt: string;
  expiresAt: string;
}

// docs/08 §56 بند 4 — "شغلانة اتقبلت، يومها عدّى، ولسه ما بدأتش". النوع ده كان **فجوة موثّقة
// صراحة** في README الموديول ("طلبات متأخرة ... محتاجة عتبة زمنية واقعية، قرار صريح من المالك
// قبل الإضافة، مش اختراع عتبة تعسفية"). المالك حدد التعريف بنفسه دلوقتي وهو مش عتبة مخترعة أصلاً:
// حالة `accepted` بالظبط (الفني ما تحرّكش) + يوم الجدولة عدّى. نفس التعريف بالحرف اللي
// `OrdersService.findOverdueForTechnician()` بيستخدمه للفني — الجانبين بيشوفوا نفس الحقيقة.
export interface OverdueOrderExceptionItem {
  orderId: string;
  orderNumber: string;
  scheduledAt: string;
  technicianId: string | null;
  technicianCode: string | null;
  fullName: string | null;
  daysLate: number;
}

// ADR-0051 (docs/08 §96) — إعادة زيارة مثبّتة على الفني الأصلي والفني **خلاص مبقاش عنده الطلب**
// (رفض/لغى بعد القبول/عدّت مهلة الرد). البند ده هو "الـrequest" اللي المالك طلبه بالحرف: بيعرض
// رقم الطلب الأصلي وبيانات تواصل الفني، والأدمن هو اللي بيحرّر (POST /admin/orders/:id/release-revisit).
export interface StalledRevisitExceptionItem {
  orderId: string;
  orderNumber: string;
  /** الطلب الأصلي اللي إعادة الزيارة دي بتخصه — نقطة التتبّع الوحيدة للأدمن. */
  originalOrderId: string | null;
  originalOrderNumber: string | null;
  technicianId: string;
  technicianCode: string;
  fullName: string;
  phone: string | null;
  pinnedAt: string;
  deadlineAt: string;
  reason: RevisitPinExhaustionReason;
  /** نصيب الفني الفعلي من الطلب الأصلي — ده بالظبط اللي هيتخصم منه لو الأدمن حرّر. */
  chargebackCents: number;
}

/**
 * **المطابقة نفسها اتأخرت** — مش الفني.
 *
 * مختلف عمدًا عن `staleDispatch` فوق: ده بيقول «عرض معيّن فات معاده بلا رد» (سلوك فني)، وده
 * بيقول «مهلة الجولة عدّت والمحرك ما فتحش الجولة اللي بعدها» (عطل في الـworkflow نفسه). خلطهم
 * كان هيخفي أخطر الاتنين: عرض بلا رد حاجة طبيعية، ومحرك واقف حاجة تانية خالص.
 */
export interface MatchingWorkflowDelayedItem {
  orderId: string;
  orderNumber: string;
  currentRound: number;
  maxRounds: number;
  /** المهلة اللي كان المفروض التوسيع يحصل عندها. */
  expectedExpansionAt: string;
  /** ثواني التأخير عن المهلة دي. */
  delaySeconds: number;
  techniciansContacted: number;
}

/** طلب استنفد أو ينتظر استرداد المطابقة وقتًا طويلًا؛ تنبيه يدوي وليس إلغاءً آليًا. */
export interface StaleMatchingExceptionItem {
  orderId: string;
  orderNumber: string;
  placedAt: string;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  attemptCount: number;
  ageSeconds: number;
}

/** تنفيذ بدأ فعليًا ثم توقف طويلًا؛ القرار المالي والتشغيلي يبقى للأدمن فقط. */
export interface StaleInProgressExceptionItem {
  orderId: string;
  orderNumber: string;
  workStartedAt: string;
  technicianId: string | null;
  fullName: string | null;
  ageSeconds: number;
}

export interface AdminExceptionCenterResult {
  crewShortage: { items: CrewShortageExceptionItem[]; total: number };
  staleDispatch: { items: StaleDispatchExceptionItem[]; total: number };
  overdueOrders: { items: OverdueOrderExceptionItem[]; total: number };
  stalledRevisits: { items: StalledRevisitExceptionItem[]; total: number };
  matchingWorkflowDelayed: { items: MatchingWorkflowDelayedItem[]; total: number };
  staleMatching: { items: StaleMatchingExceptionItem[]; total: number };
  staleInProgress: { items: StaleInProgressExceptionItem[]; total: number };
  atRiskAppointments: { items: AtRiskAppointmentItem[]; total: number };
}

interface RawAtRiskRow {
  id: string;
  order_number: string;
  scheduled_at: string;
  risk_level: AtRiskLevel;
  order_status: string;
  technician_id: string | null;
  technician_code: string | null;
  full_name: string | null;
  phone: string | null;
  minutes_from_appointment: string;
  technician_departed_at: string | null;
  last_location_at: string | null;
  last_activity_at: string | null;
  total_count: string;
}

interface RawWorkflowDelayedRow {
  order_id: string;
  order_number: string;
  current_round: string;
  technicians_contacted: string;
  expected_expansion_at: string;
  delay_seconds: string;
  total_count: string;
}

interface RawOverdueOrderRow {
  id: string;
  order_number: string;
  scheduled_at: string;
  technician_id: string | null;
  technician_code: string | null;
  full_name: string | null;
  total_count: string;
}

interface RawCrewShortageRow {
  id: string;
  order_number: string;
  scheduled_at: string;
  crew_shortage_escalated_at: string;
  required_technicians: number | null;
  required_assistants: number | null;
  technicians: string;
  assistants: string;
  total_count: string;
}

interface RawStalledRevisitRow {
  id: string;
  order_number: string;
  original_order_id: string | null;
  original_order_number: string | null;
  technician_id: string;
  technician_code: string;
  full_name: string;
  phone: string | null;
  revisit_pinned_at: string;
  deadline_at: string;
  reason: RevisitPinExhaustionReason;
  chargeback_cents: string | null;
  total_count: string;
}

interface RawStaleDispatchRow {
  id: string;
  order_number: string;
  order_id: string;
  technician_id: string;
  technician_code: string;
  full_name: string;
  sent_at: string;
  expires_at: string;
  total_count: string;
}

interface RawStaleMatchingRow {
  id: string;
  order_number: string;
  placed_at: string;
  last_matching_attempt_at: string | null;
  next_matching_attempt_at: string | null;
  matching_attempt_count: string;
  age_seconds: string;
  total_count: string;
}

interface RawStaleInProgressRow {
  id: string;
  order_number: string;
  work_started_at: string;
  technician_id: string | null;
  full_name: string | null;
  age_seconds: string;
  total_count: string;
}

/**
 * مركز الاستثناءات/التنبيهات (docs/08 §36.9) — "فوق تصعيد §35.4 + تنبيهات جديدة". قايمة
 * "محتاج تصرّف دلوقتي" مش جدول قابل للتصفح — نفس فلسفة كارت "يحتاج انتباه" في `apps/admin/src/app
 * /page.tsx` (الأدمن العام)، بس مُركّزة على نطاق العمليات/المطابقة. صفر نوع استثناء مخترع بعتبة
 * وقت تعسفية — نوعين بس دلوقتي، الاتنين مبنيين على حقول/شروط حقيقية موجودة بالفعل:
 *
 *  1. **نقص طاقم مصعّد ولسه مفتوح** — إعادة استخدام حرفي لـ`crew_shortage_escalated_at`/
 *     `ESCALATABLE_STATUSES` (§35.4/§35.5، `CrewShortageEscalationService`) و`computeCrewComposition()`
 *     (§35، `order-team.service.ts`) — نفس دالة حساب النقص المستخدمة في تنفيذ العملية الحقيقية،
 *     صفر نسخة موازية. Bulk aggregate بـLEFT JOIN + `COUNT(*) FILTER` بدل نداء منفصل لكل طلب.
 *  2. **توزيع متأخر (stale dispatch)** — نفس شرط `stale_sent_count`/`is_stale` بالحرف من §36.7
 *     (`order_assignments.assignment_status='sent' AND expires_at < now()`), بس هنا **بلا نافذة
 *     hours محدودة** عمدًا (مختلف عن §36.7's rolling observability window) — "لسه sent ومعادها
 *     فات" حالة سيئة بغض النظر عن إمتى اتبعتت، مش نشاط حديث بس.
 *
 * القايمتين محدودتين بـ`EXCEPTION_LIST_LIMIT` (50) — الشاشة دي "لمحة تحتاج تصرّف فوري"، مش أداة
 * تصفح كاملة (لو العدد الحقيقي أكبر، `total` بيعكس الرقم الحقيقي كامل، والتفصيل الكامل موجود في
 * `/orders` المفلترة أو §36.7's dispatch-delivery feed).
 */
@Injectable()
export class AdminExceptionCenterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdminExceptionCenterService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    // اختياري: الاختبارات القديمة بتبني الخدمة بمعاملين (القراءة بس) — التنبيه بيتخطّى من غيره.
    @Optional() private readonly routingService?: NotificationRoutingService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      void runExclusiveSweep(this.dataSource, 'at-risk-appointments', () => this.alertAtRiskTransitions(), this.logger);
    }, AT_RISK_SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async atRiskThresholds(): Promise<{ warn: number; grace: number }> {
    const [warn, grace] = await Promise.all([
      this.settingsService.getNumber('operations.departure_warning_minutes', DEPARTURE_WARNING_MINUTES_FALLBACK),
      this.settingsService.getNumber('operations.arrival_grace_minutes', ARRIVAL_GRACE_MINUTES_FALLBACK),
    ]);
    return { warn: Math.max(0, Math.floor(warn)), grace: Math.max(0, Math.floor(grace)) };
  }

  /**
   * التصنيف نفسه — مصدر واحد للقايمة وللتنبيه. `$1` = دقايق التحذير، `$2` = سماحية الوصول.
   *
   * الخدمات «باليوم بس» متستثنية: الموعد عندها متخزّن منتصف الليل UTC (مش ساعة وصول)، وكانت كلها
   * هتبان «متأخرة» من أول اليوم. والطلب اللي يومه عدّى وهو accepted مكانه `overdueOrders`، مش هنا.
   */
  private atRiskCte(): string {
    return `
      risk AS (
        SELECT o.id, o.order_number, o.scheduled_at, o.order_status::text AS order_status, o.technician_id,
               o.technician_departed_at, o.at_risk_alert_level, o.service_zone_id, s.category_id,
               CASE
                 WHEN o.technician_arrived_at IS NULL
                      AND now() >= o.scheduled_at + make_interval(mins => $2::int)
                   THEN 'late_arrival'
                 WHEN o.technician_departed_at IS NULL AND o.order_status IN ('technician_assigned', 'accepted')
                      AND now() >= o.scheduled_at
                   THEN 'late_departure'
                 WHEN o.technician_departed_at IS NULL AND o.order_status IN ('technician_assigned', 'accepted')
                      AND now() >= o.scheduled_at - make_interval(mins => $1::int)
                   THEN 'watch'
               END AS risk_level
        FROM orders o
        JOIN services s ON s.id = o.service_id
        WHERE o.deleted_at IS NULL
          AND o.order_status IN ('technician_assigned', 'accepted', 'technician_on_way')
          AND o.scheduled_at IS NOT NULL
          AND s.requires_start_time_only = true
          AND o.scheduled_at <> date_trunc('day', o.scheduled_at)
          AND o.scheduled_at >= now() - interval '12 hours'
          AND o.scheduled_at <= now() + make_interval(mins => $1::int)
          AND NOT (
            o.order_status = 'accepted'
            AND (o.scheduled_at AT TIME ZONE 'Africa/Cairo')::date < (now() AT TIME ZONE 'Africa/Cairo')::date
          )
      )`;
  }

  /**
   * تنبيه العمليات لما صف **يدخل** الأصفر أو الأحمر — مرة واحدة لكل مستوى. الـUPDATE نفسه هو الـcompare-
   * and-set (`at_risk_alert_level` بيطلع لفوق بس)، فدورتين متوازيتين أو نفس الدقيقة تاني مابيطلّعوش
   * تنبيه مكرر. مركز الاستثناءات يفضل مصدر الحقيقة؛ ده مجرد جرس.
   */
  async alertAtRiskTransitions(): Promise<number> {
    if (!this.routingService) return 0;
    const { warn, grace } = await this.atRiskThresholds();
    const promoted = await this.dataSource.query<
      { id: string; order_number: string; scheduled_at: string; risk_level: 'late_departure' | 'late_arrival'; full_name: string | null; phone: string | null; moved: boolean }[]
    >(
      `
      WITH ${this.atRiskCte()},
      promoted AS (
        UPDATE orders o
           SET at_risk_alert_level = r.risk_level, at_risk_alerted_at = now()
          FROM risk r
         WHERE o.id = r.id
           AND r.risk_level IN ('late_departure', 'late_arrival')
           AND (o.at_risk_alert_level IS NULL OR (o.at_risk_alert_level = 'late_departure' AND r.risk_level = 'late_arrival'))
        RETURNING o.id, o.order_number, o.scheduled_at, r.risk_level, o.technician_id, (o.technician_departed_at IS NOT NULL) AS moved
      )
      SELECT p.id, p.order_number, p.scheduled_at, p.risk_level, p.moved, u.full_name, u.phone_number AS phone
        FROM promoted p
        LEFT JOIN technician_profiles tp ON tp.id = p.technician_id
        LEFT JOIN users u ON u.id = tp.user_id
      `,
      [warn, grace],
    );
    for (const row of promoted) {
      const when = new Intl.DateTimeFormat('ar-EG', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Cairo' }).format(
        new Date(row.scheduled_at),
      );
      const who = row.full_name ? `الفني ${row.full_name}${row.phone ? ` (${row.phone})` : ''}` : 'الفني';
      const late = row.risk_level === 'late_arrival';
      await this.routingService.routeToRole(AT_RISK_ROUTING_EVENT, {
        notificationType: 'order_appointment_at_risk',
        titleAr: late ? `تأخر في الوصول — ${row.order_number}` : `الفني لسه ماتحرّكش — ${row.order_number}`,
        bodyAr: late
          ? `الموعد كان ${when} و${who} لسه ماوصلش${row.moved ? ' (اتحرك)' : ' ولا اتحرك'}. اتصل بيه وبلّغ العميل، ولو محتاج استخدم إعادة التعيين أو الجدولة من صفحة الطلب.`
          : `الموعد ${when} و${who} لسه ماتحرّكش. اتصل بيه واتأكد، وبلّغ العميل لو فيه تأخير.`,
        referenceType: 'order',
        referenceId: row.id,
        deepLink: `/orders/${row.id}`,
      });
    }
    return promoted.length;
  }

  async getExceptions(filters: ExceptionCenterFilters): Promise<AdminExceptionCenterResult> {
    const categoryId = filters.categoryId ?? null;
    const zoneId = filters.zoneId ?? null;

    const crewShortageRows = await this.dataSource.query<RawCrewShortageRow[]>(
      `
      WITH crew AS (
        SELECT o.id, o.order_number, o.scheduled_at, o.crew_shortage_escalated_at,
               o.required_technicians, o.required_assistants,
               -- ADR-0101 — العدّ بالخانة (crew_slot) مش بالطبقة المالية (member_type).
               COUNT(otm.*) FILTER (WHERE otm.crew_slot = 'execution') AS technicians,
               COUNT(otm.*) FILTER (WHERE otm.crew_slot = 'helper') AS assistants
        FROM orders o
        LEFT JOIN order_team_members otm ON otm.order_id = o.id
        JOIN services s ON s.id = o.service_id
        WHERE o.deleted_at IS NULL
          AND o.crew_shortage_escalated_at IS NOT NULL
          AND o.order_status = ANY($1::order_status[])
          AND ($2::uuid IS NULL OR s.category_id = $2)
          AND ($3::uuid IS NULL OR o.service_zone_id = $3)
        GROUP BY o.id
      )
      -- شرط "لسه ناقص" هنا لازم يطابق computeCrewComposition() بالحرف (order-team.service.ts) —
      -- +1 لتقنيي المُعيَّنين تمثيلًا لقائد الطلب نفسه، GREATEST(0, ...) لمنع سالب. مُعاد فحصه
      -- تاني بـTS تحت بنفس الدالة الحقيقية — الشرط هنا للفلترة/العدّ الصحيح بس، مش مصدر الحقيقة.
      SELECT *, COUNT(*) OVER() AS total_count
      FROM crew
      WHERE GREATEST(0, COALESCE(required_technicians, 1) - (technicians + 1)) > 0
         OR GREATEST(0, COALESCE(required_assistants, 0) - assistants) > 0
      ORDER BY scheduled_at ASC
      LIMIT $4
      `,
      [ESCALATABLE_STATUSES, categoryId, zoneId, EXCEPTION_LIST_LIMIT],
    );

    const now = Date.now();
    const crewShortageItems: CrewShortageExceptionItem[] = crewShortageRows.map((r) => {
      const composition = computeCrewComposition(r.required_technicians, r.required_assistants, {
        technicians: Number(r.technicians),
        assistants: Number(r.assistants),
      });
      return {
        orderId: r.id,
        orderNumber: r.order_number,
        scheduledAt: r.scheduled_at,
        escalatedAt: r.crew_shortage_escalated_at,
        missingTechnicians: composition.missingTechnicians,
        missingAssistants: composition.missingAssistants,
        isOverdue: new Date(r.scheduled_at).getTime() < now,
      };
    });
    const staleDispatchRows = await this.dataSource.query<RawStaleDispatchRow[]>(
      `
      SELECT oa.id, oa.order_id, o.order_number, oa.technician_id, tp.technician_code, u.full_name,
             oa.sent_at, oa.expires_at, COUNT(*) OVER() AS total_count
      FROM order_assignments oa
      JOIN orders o ON o.id = oa.order_id
      JOIN services s ON s.id = o.service_id
      JOIN technician_profiles tp ON tp.id = oa.technician_id
      JOIN users u ON u.id = tp.user_id
      -- 'viewed' = وصل واتعرض بس ما اترد عليهوش (docs/08 §72) — استثناء زيّه بالظبط.
      WHERE oa.assignment_status IN ('sent', 'viewed') AND oa.expires_at < now()
        -- إعادة زيارة مثبّتة عمرها ما تكون "توزيع متأخر": العرض مقصود إنه يفضل مفتوح لحد
        -- ما مهلة الفني الأصلي تعدّي (ADR-0051)، وليها بندها الخاص تحت.
        AND NOT (o.revisit_pinned_technician_id IS NOT NULL AND o.revisit_released_at IS NULL)
        AND ($1::uuid IS NULL OR s.category_id = $1)
        AND ($2::uuid IS NULL OR o.service_zone_id = $2)
      ORDER BY oa.expires_at ASC
      LIMIT $3
      `,
      [categoryId, zoneId, EXCEPTION_LIST_LIMIT],
    );

    const staleDispatchItems: StaleDispatchExceptionItem[] = staleDispatchRows.map((r) => ({
      assignmentId: r.id,
      orderId: r.order_id,
      orderNumber: r.order_number,
      technicianId: r.technician_id,
      technicianCode: r.technician_code,
      fullName: r.full_name,
      sentAt: r.sent_at,
      expiresAt: r.expires_at,
    }));

    // نفس شرط findOverdueForTechnician() بالحرف: accepted + يوم الجدولة عدّى (بتوقيت مصر —
    // الجدولة باليوم مش بالساعة، ADR-0018 §2، فمقارنة بـnow() الخام كانت هتعتبر شغل النهاردة متأخر).
    const overdueRows = await this.dataSource.query<RawOverdueOrderRow[]>(
      `
      SELECT o.id, o.order_number, o.scheduled_at, o.technician_id, tp.technician_code, u.full_name,
             COUNT(*) OVER() AS total_count
      FROM orders o
      JOIN services s ON s.id = o.service_id
      LEFT JOIN technician_profiles tp ON tp.id = o.technician_id
      LEFT JOIN users u ON u.id = tp.user_id
      WHERE o.deleted_at IS NULL
        AND o.order_status = 'accepted'
        AND o.scheduled_at IS NOT NULL
        AND (o.scheduled_at AT TIME ZONE 'Africa/Cairo')::date < (now() AT TIME ZONE 'Africa/Cairo')::date
        AND ($1::uuid IS NULL OR s.category_id = $1)
        AND ($2::uuid IS NULL OR o.service_zone_id = $2)
      ORDER BY o.scheduled_at ASC
      LIMIT $3
      `,
      [categoryId, zoneId, EXCEPTION_LIST_LIMIT],
    );

    const overdueItems: OverdueOrderExceptionItem[] = overdueRows.map((r) => ({
      orderId: r.id,
      orderNumber: r.order_number,
      scheduledAt: r.scheduled_at,
      technicianId: r.technician_id,
      technicianCode: r.technician_code,
      fullName: r.full_name,
      daysLate: Math.max(1, Math.floor((now - new Date(r.scheduled_at).getTime()) / (24 * 60 * 60 * 1000))),
    }));

    // ADR-0051 — "اتقفل" مشتقّة من مصادر الحقيقة الموجودة (رفض مسجّل في order_assignments، أو
    // إلغاء بعد القبول في technician_order_cancellations، أو عدّت المهلة) — مفيش عمود حالة موازي
    // ممكن يتعارض مع السجلات الفعلية. نفس منطق loadRevisitPinState() بالحرف، بس bulk.
    const revisitWindowHours = await this.settingsService.getNumber(
      REVISIT_RESPONSE_WINDOW_HOURS_SETTING,
      REVISIT_RESPONSE_WINDOW_HOURS_FALLBACK,
    );
    const stalledRevisitRows = await this.dataSource.query<RawStalledRevisitRow[]>(
      `
      SELECT o.id, o.order_number,
             parent.id AS original_order_id, parent.order_number AS original_order_number,
             o.revisit_pinned_technician_id AS technician_id, tp.technician_code, u.full_name, u.phone_number AS phone,
             o.revisit_pinned_at,
             (o.revisit_pinned_at + make_interval(hours => $3::int)) AS deadline_at,
             CASE WHEN refusal.refused THEN 'refused' ELSE 'no_response' END AS reason,
             -- نصيبه الفعلي من الطلب الأصلي — order_earning_shares هو مصدر الحقيقة (نفس مصدر
             -- كشف المستحقات)، وbackfill لـtechnician_earning_cents للطلبات الفردية القديمة
             -- اللي اتقفلت قبل نظام الحصص.
             COALESCE(
               (SELECT oes.share_cents FROM order_earning_shares oes
                 WHERE oes.order_id = parent.id AND oes.technician_id = o.revisit_pinned_technician_id
                   AND oes.deleted_at IS NULL),
               parent.technician_earning_cents,
               0
             ) AS chargeback_cents,
             COUNT(*) OVER() AS total_count
      FROM orders o
      JOIN services s ON s.id = o.service_id
      JOIN technician_profiles tp ON tp.id = o.revisit_pinned_technician_id
      JOIN users u ON u.id = tp.user_id
      LEFT JOIN orders parent ON parent.id = o.parent_order_id
      CROSS JOIN LATERAL (
        SELECT (
          EXISTS (SELECT 1 FROM order_assignments oa
                   WHERE oa.order_id = o.id AND oa.technician_id = o.revisit_pinned_technician_id
                     AND oa.assignment_status = 'rejected')
          OR EXISTS (SELECT 1 FROM technician_order_cancellations toc
                      WHERE toc.order_id = o.id AND toc.technician_id = o.revisit_pinned_technician_id)
        ) AS refused
      ) refusal
      WHERE o.deleted_at IS NULL
        AND o.revisit_pinned_technician_id IS NOT NULL
        AND o.revisit_released_at IS NULL
        AND o.order_status = 'searching_technician'
        AND (refusal.refused OR o.revisit_pinned_at + make_interval(hours => $3::int) <= now())
        AND ($1::uuid IS NULL OR s.category_id = $1)
        AND ($2::uuid IS NULL OR o.service_zone_id = $2)
      ORDER BY o.revisit_pinned_at ASC
      LIMIT $4
      `,
      [categoryId, zoneId, revisitWindowHours, EXCEPTION_LIST_LIMIT],
    );

    const stalledRevisitItems: StalledRevisitExceptionItem[] = stalledRevisitRows.map((r) => ({
      orderId: r.id,
      orderNumber: r.order_number,
      originalOrderId: r.original_order_id,
      originalOrderNumber: r.original_order_number,
      technicianId: r.technician_id,
      technicianCode: r.technician_code,
      fullName: r.full_name,
      phone: r.phone,
      pinnedAt: r.revisit_pinned_at,
      deadlineAt: r.deadline_at,
      reason: r.reason,
      chargebackCents: Number(r.chargeback_cents ?? 0),
    }));

    // **المطابقة اتأخرت** (Admin Operations Observability) — الطلب لسه بيدوّر، مهلة آخر جولة
    // عدّت، ومفيش أي عرض في جولة أحدث. يعني المحرك كان المفروض يوسّع وما وسّعش.
    //
    // الشرط deterministic بالكامل من الداتابيز: مفيش تخمين ولا عتبة مخترعة — المهلة نفسها
    // (`expires_at`) هي اللي المحرك كتبها، وإحنا بنقارنها بالساعة وبس.
    //
    // الجولة الأخيرة لو وصلت `matching.max_rounds` **مش** تأخير — دي مطابقة استنفدت، وليها
    // معنى تاني خالص (مفيش فنيين، مش محرك واقف).
    const maxRoundsForDelay = await this.settingsService.getNumber('matching.max_rounds', 4);
    const workflowDelayedRows = await this.dataSource.query<RawWorkflowDelayedRow[]>(
      `
      WITH last_round AS (
        SELECT oa.order_id,
               MAX(oa.assignment_round) AS current_round,
               COUNT(DISTINCT oa.technician_id) AS technicians_contacted
        FROM order_assignments oa
        GROUP BY oa.order_id
      ),
      due AS (
        SELECT lr.order_id, lr.current_round, lr.technicians_contacted,
               MAX(oa.expires_at) AS expected_expansion_at
        FROM last_round lr
        JOIN order_assignments oa
          ON oa.order_id = lr.order_id AND oa.assignment_round = lr.current_round
        GROUP BY lr.order_id, lr.current_round, lr.technicians_contacted
      )
      SELECT o.id AS order_id, o.order_number, d.current_round, d.technicians_contacted,
             d.expected_expansion_at,
             EXTRACT(EPOCH FROM (now() - d.expected_expansion_at))::int AS delay_seconds,
             COUNT(*) OVER() AS total_count
      FROM due d
      JOIN orders o ON o.id = d.order_id
      JOIN services s ON s.id = o.service_id
      WHERE o.order_status = 'searching_technician'
        AND o.deleted_at IS NULL
        AND d.expected_expansion_at < now()
        AND d.current_round < $3::int
        AND ($1::uuid IS NULL OR s.category_id = $1)
        AND ($2::uuid IS NULL OR o.service_zone_id = $2)
      ORDER BY d.expected_expansion_at ASC
      LIMIT $4
      `,
      [categoryId, zoneId, maxRoundsForDelay, EXCEPTION_LIST_LIMIT],
    );

    const workflowDelayedItems: MatchingWorkflowDelayedItem[] = workflowDelayedRows.map((r) => ({
      orderId: r.order_id,
      orderNumber: r.order_number,
      currentRound: Number(r.current_round),
      maxRounds: maxRoundsForDelay,
      expectedExpansionAt: r.expected_expansion_at,
      delaySeconds: Number(r.delay_seconds),
      techniciansContacted: Number(r.technicians_contacted),
    }));

    // الطلبات التي فشلت جولات مطابقتها تظل قابلة لإعادة المحاولة عمدًا (لا إسقاط صامت ولا
    // إلغاء آلي). هذا التنبيه فقط يمنعها من الاختفاء من عمليات الإدارة بعد نفاد max_rounds.
    const staleMatchingHours = Math.max(
      1,
      Math.floor(await this.settingsService.getNumber('orders.stale_matching_hours', 24)),
    );
    const staleMatchingRows = await this.dataSource.query<RawStaleMatchingRow[]>(
      `
      SELECT o.id, o.order_number, COALESCE(o.placed_at, o.created_at) AS placed_at,
             o.last_matching_attempt_at, o.next_matching_attempt_at, o.matching_attempt_count,
             EXTRACT(EPOCH FROM (now() - COALESCE(o.placed_at, o.created_at)))::int AS age_seconds,
             COUNT(*) OVER() AS total_count
      FROM orders o
      JOIN services s ON s.id = o.service_id
      WHERE o.deleted_at IS NULL
        AND o.order_status = 'searching_technician'
        AND COALESCE(o.placed_at, o.created_at) <= now() - make_interval(hours => $3::int)
        AND NOT EXISTS (
          SELECT 1 FROM order_assignments oa
          WHERE oa.order_id = o.id AND oa.assignment_status IN ('sent', 'viewed') AND oa.expires_at > now()
        )
        AND NOT (o.revisit_pinned_technician_id IS NOT NULL AND o.revisit_released_at IS NULL)
        AND ($1::uuid IS NULL OR s.category_id = $1)
        AND ($2::uuid IS NULL OR o.service_zone_id = $2)
      ORDER BY COALESCE(o.placed_at, o.created_at) ASC
      LIMIT $4
      `,
      [categoryId, zoneId, staleMatchingHours, EXCEPTION_LIST_LIMIT],
    );
    const staleMatchingItems: StaleMatchingExceptionItem[] = staleMatchingRows.map((r) => ({
      orderId: r.id,
      orderNumber: r.order_number,
      placedAt: r.placed_at,
      lastAttemptAt: r.last_matching_attempt_at,
      nextAttemptAt: r.next_matching_attempt_at,
      attemptCount: Number(r.matching_attempt_count),
      ageSeconds: Number(r.age_seconds),
    }));

    const staleInProgressHours = Math.max(
      1,
      Math.floor(await this.settingsService.getNumber('orders.stale_in_progress_hours', 48)),
    );
    const staleInProgressRows = await this.dataSource.query<RawStaleInProgressRow[]>(
      `
      SELECT o.id, o.order_number, o.work_started_at, o.technician_id, u.full_name,
             EXTRACT(EPOCH FROM (now() - o.work_started_at))::int AS age_seconds,
             COUNT(*) OVER() AS total_count
      FROM orders o
      JOIN services s ON s.id = o.service_id
      LEFT JOIN technician_profiles tp ON tp.id = o.technician_id
      LEFT JOIN users u ON u.id = tp.user_id
      WHERE o.deleted_at IS NULL
        AND o.order_status = 'in_progress'
        AND o.work_started_at IS NOT NULL
        AND o.work_started_at <= now() - make_interval(hours => $3::int)
        AND ($1::uuid IS NULL OR s.category_id = $1)
        AND ($2::uuid IS NULL OR o.service_zone_id = $2)
      ORDER BY o.work_started_at ASC
      LIMIT $4
      `,
      [categoryId, zoneId, staleInProgressHours, EXCEPTION_LIST_LIMIT],
    );
    const staleInProgressItems: StaleInProgressExceptionItem[] = staleInProgressRows.map((r) => ({
      orderId: r.id,
      orderNumber: r.order_number,
      workStartedAt: r.work_started_at,
      technicianId: r.technician_id,
      fullName: r.full_name,
      ageSeconds: Number(r.age_seconds),
    }));

    const { warn, grace } = await this.atRiskThresholds();
    const atRiskRows = await this.dataSource.query<RawAtRiskRow[]>(
      `
      WITH ${this.atRiskCte()}
      SELECT r.id, r.order_number, r.scheduled_at, r.risk_level, r.order_status, r.technician_id,
             tp.technician_code, u.full_name, u.phone_number AS phone,
             ROUND(EXTRACT(EPOCH FROM (now() - r.scheduled_at)) / 60)::int AS minutes_from_appointment,
             r.technician_departed_at, tp.current_location_updated_at AS last_location_at,
             GREATEST(
               (SELECT MAX(h.created_at) FROM order_status_history h WHERE h.order_id = r.id),
               tp.current_location_updated_at
             ) AS last_activity_at,
             COUNT(*) OVER() AS total_count
        FROM risk r
        LEFT JOIN technician_profiles tp ON tp.id = r.technician_id
        LEFT JOIN users u ON u.id = tp.user_id
       WHERE r.risk_level IS NOT NULL
         AND ($3::uuid IS NULL OR r.category_id = $3)
         AND ($4::uuid IS NULL OR r.service_zone_id = $4)
       ORDER BY CASE r.risk_level WHEN 'late_arrival' THEN 0 WHEN 'late_departure' THEN 1 ELSE 2 END, r.scheduled_at ASC
       LIMIT $5
      `,
      [warn, grace, categoryId, zoneId, EXCEPTION_LIST_LIMIT],
    );
    const atRiskItems: AtRiskAppointmentItem[] = atRiskRows.map((r) => ({
      orderId: r.id,
      orderNumber: r.order_number,
      scheduledAt: r.scheduled_at,
      level: r.risk_level,
      orderStatus: r.order_status,
      technicianId: r.technician_id,
      technicianCode: r.technician_code,
      fullName: r.full_name,
      phone: r.phone,
      minutesFromAppointment: Number(r.minutes_from_appointment),
      moved: r.technician_departed_at !== null,
      departedAt: r.technician_departed_at,
      lastLocationAt: r.last_location_at,
      lastActivityAt: r.last_activity_at,
    }));

    return {
      atRiskAppointments: {
        items: atRiskItems,
        total: atRiskRows.length > 0 ? Number(atRiskRows[0].total_count) : 0,
      },
      staleMatching: {
        items: staleMatchingItems,
        total: staleMatchingRows.length > 0 ? Number(staleMatchingRows[0].total_count) : 0,
      },
      staleInProgress: {
        items: staleInProgressItems,
        total: staleInProgressRows.length > 0 ? Number(staleInProgressRows[0].total_count) : 0,
      },
      matchingWorkflowDelayed: {
        items: workflowDelayedItems,
        total: workflowDelayedRows.length > 0 ? Number(workflowDelayedRows[0].total_count) : 0,
      },
      stalledRevisits: {
        items: stalledRevisitItems,
        total: stalledRevisitRows.length > 0 ? Number(stalledRevisitRows[0].total_count) : 0,
      },
      overdueOrders: {
        items: overdueItems,
        total: overdueRows.length > 0 ? Number(overdueRows[0].total_count) : 0,
      },
      crewShortage: {
        items: crewShortageItems,
        total: crewShortageRows.length > 0 ? Number(crewShortageRows[0].total_count) : 0,
      },
      staleDispatch: {
        items: staleDispatchItems,
        total: staleDispatchRows.length > 0 ? Number(staleDispatchRows[0].total_count) : 0,
      },
    };
  }
}
