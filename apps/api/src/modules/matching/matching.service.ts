import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ORDER_ACCEPTED_EVENT, OrderAcceptedEvent } from '../../common/events/order-accepted.event';
import { ORDER_OFFER_CREATED_EVENT, OrderOfferCreatedEvent } from '../../common/events/order-offer-created.event';
import { ORDER_OFFER_RESOLVED_EVENT, OrderOfferResolvedEvent } from '../../common/events/order-offer-resolved.event';
import {
  ORDER_EMERGENCY_DISPATCH_STRUGGLING_EVENT,
  OrderEmergencyDispatchStrugglingEvent,
} from '../../common/events/order-emergency-dispatch-struggling.event';
import { ORDER_NO_TECHNICIAN_FOUND_EVENT, OrderNoTechnicianFoundEvent } from '../../common/events/order-no-technician-found.event';
import { WORK_OPPORTUNITY_OFFERED_EVENT, WorkOpportunityOfferedEvent } from '../../common/events/work-opportunity-offered.event';
import { BookingMode, Order, OrderStatus } from '../orders/entities/order.entity';
import { OrderChangeSource, OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES, canTransition } from '../orders/order-state-machine';
import { SettingsService } from '../settings/settings.service';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import {
  classifyTechnicianCapacity,
  technicianAvailabilityCondition,
  TechnicianCapacityTier,
} from '../technicians/technician-eligibility.sql';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { AssignmentStatus, OrderAssignment } from './entities/order-assignment.entity';
import { MATCHING_ROUNDS_QUEUE, ROUND_EXPIRED_JOB, RoundExpiredJobData, roundExpiredJobId } from './matching-rounds.queue';

// القيم دي مطابقة لإعدادات matching.* الافتراضية في infra/migrations/0011_system.sql (§11.2 في القاموس)
// — دلوقتي fallback بس لـ SettingsService.getNumber، مش المصدر الحقيقي (نفس نمط payouts، راجع
// settings/README.md). كانت فجوة موثّقة صراحة في تعليق قديم هنا يقول "لما لوحة الإدارة تتبني هتتقرأ
// من جدول settings" — اللوحة اتبنت، اتقفلت.
const BATCH_SIZE_FALLBACK = 5;
const RESPONSE_TIMEOUT_SECONDS_FALLBACK = 30;
const MAX_ROUNDS_FALLBACK = 4;
// هيكل الحجز الجديد (docs/06 §1.7، docs/07 الجزء ج) — "طوارئ": دفعة أكبر ("أول عشرة" بالحرف
// من كلام المالك) + تجاهل فلتر is_available/is_on_duty في findEligibleTechnicians تحت.
const EMERGENCY_BATCH_SIZE_FALLBACK = 10;
// تدرّج دفعات الطوارئ (docs/08 §17.15) — دفعة أولى/تالية منفصلتين (قابل للتعديل بشكل مستقل)،
// مهلة رد أقصر من الطلب العادي (استعجال حقيقي)، سقف أقصى لإجمالي الفنيين المتواصَل معاهم عبر
// كل الجولات مجتمعة (مختلف عن matching.max_rounds — ده بيحدّ عدد *الجولات*، ده بيحدّ عدد
// *الفنيين* الكلي، مفيد لو batch size كبير وعدد الجولات قليل)، وعتبة تصعيد للأدمن لو الطوارئ
// بتاخد وقت أطول من المتوقع من غير ما تتلغي لسه.
const EMERGENCY_SUBSEQUENT_BATCH_SIZE_FALLBACK = 10;
const EMERGENCY_RESPONSE_TIMEOUT_SECONDS_FALLBACK = 20;
const EMERGENCY_MAX_TECHNICIANS_CONTACTED_FALLBACK = 40;
const EMERGENCY_ESCALATION_AFTER_ROUNDS_FALLBACK = 2;
// **تصحيح جوهري (ADR-0018، طلب صريح من المالك 2026-08-19)** فوق ADR-0017 بند 7 القديم — الانقسام
// مش "قريب/بعيد" (near_term_request_days بقت بلا استخدام فعلي هنا)، الانقسام الحقيقي هو
// "طوارئ/مجدول": بس الطوارئ محتاجة قبول فني صريح (dispatchNextRound)، أي طلب تاني (عادي أو
// "Quick Job" — شغل صغير، مش عاجل، لسه بيتبع نفس نموذج الحجز المجدول العادي) بيتأكد تلقائيًا
// (autoConfirmScheduledOrder تحت) بلا انتظار قبول، بغض النظر عن قرب موعده.
// حد "شغل يوم كامل" (ADR-0018 §2/§9) — الشغل اللي فوق الحد ده بالدقايق (أو estimated_duration_days
// >= 1) بيُعتبر شاغل يوم الفني بالكامل لغرض تعارض الجدولة اليومية (technician-eligibility.sql.ts).
const FULL_DAY_JOB_MINUTES_FALLBACK = 360;
// ADR-0017 بند 10 — الجولة اللي بعدها يتوسّع البحث لفنيين "مرتبطين بس مشغولين بطلب نشط دلوقتي"
// (نفس شرط الخدمة/المنطقة يفضل ساري دايمًا). قيمة كبيرة (أكبر من matching.max_rounds) = تعطيل.
const BROADEN_TO_BUSY_AFTER_ROUND_FALLBACK = 4;
// ADR-0018 §7 (طلب صريح من المالك 2026-08-19) — بعد ما الفني بقى متاح افتراضيًا (ADR-0017 بند 3)،
// كل الفنيين المؤهلين بقوا "مرشّحين" دايمًا، فمن غير توازن حِمل هيتكرّر إسناد نفس الفني الأعلى
// مستوى/الأقرب لكل الطلبات على طول. الوزن ده بيتطرح من order_priority_weight لكل طلب "نشط"
// (ACTIVE_TECHNICIAN_ORDER_STATUSES) عند الفني — مش استبدال لترتيب المستوى/المسافة، إضافة ليه
// (راجع findEligibleTechnicians تحت للتفصيل الكامل).
const WORKLOAD_BALANCE_WEIGHT_FALLBACK = 2;
// نموذج العدالة بالتاريخ الحديث (docs/08 §34.2، ADR-0020 §6) — إضافة فوق موازنة الحِمل الحالي
// الموجودة (workload_balance_weight)، مش بديلة ليها: دي بتقيس "مشغول دلوقتي"، دي بتقيس "خد شغل
// كتير الأسبوع اللي فات حتى لو فاضي دلوقتي". افتراضي معطّل تمامًا (fairness_weight=0) — مفعّل
// بس لما الأدمن يزوّد القيمة من /admin/settings بلا أي كود.
const FAIRNESS_LOOKBACK_DAYS_FALLBACK = 7;
const FAIRNESS_WEIGHT_FALLBACK = 0;
const FAIRNESS_DECLINE_WEIGHT_FALLBACK = 0.5;
// كسر التعادل بين مرشحين متقاربين جدًا في الترتيب (docs/08 §34.2، ADR-0020 §6، بند T من رسالة
// المالك — "avoid permanent deterministic winners"). افتراضي معطّل (0 = مفيش نطاق تعادل خالص).
const TIE_BREAK_THRESHOLD_FALLBACK = 0;
// docs/08 §36.20-21، ADR-0023 — وزن الموثوقية، معطّل افتراضيًا زي fairness_weight.
const RELIABILITY_WEIGHT_FALLBACK = 0;
const RELIABILITY_BASELINE_RATING_FALLBACK = 4.0;
const RELIABILITY_MIN_RATINGS_COUNT_FALLBACK = 3;

export interface EligibleTechnicianRow {
  technician_id: string;
  distance_km: string;
  rank_score: string;
  // docs/08 §36.20-21، ADR-0023 — تفكيك مكوّنات rank_score للتفسير (§36.6)، صفر تأثير على الترتيب نفسه.
  priority_component: string;
  workload_penalty: string;
  fairness_penalty: string;
  reliability_adjustment: string;
}

export interface AvailableOrderRow {
  assignment_id: string;
  order_id: string;
  order_number: string;
  service_name_ar: string;
  problem_description: string | null;
  street_name: string;
  landmark: string | null;
  distance_km: string;
  expires_at: Date;
}

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    @InjectRepository(OrderAssignment) private readonly assignments: Repository<OrderAssignment>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly techniciansService: TechniciansService,
    private readonly assignmentGuard: TechnicianAssignmentGuardService,
    private readonly settingsService: SettingsService,
    private readonly events: EventEmitter2,
    @InjectQueue(MATCHING_ROUNDS_QUEUE) private readonly roundsQueue: Queue<RoundExpiredJobData>,
    private readonly workOpportunities: TechnicianWorkOpportunitiesService,
  ) {}

  /**
   * أقرب فنيين مؤهلين (خدمة + منطقة + متاح + معتمد) لعنوان الطلب، من غير اللي اتبعتلهم قبل كده
   * على نفس الطلب. الترتيب: أولوية المستوى (technician_level_config.order_priority_weight)
   * **مطروح منها حِمل شغل الفني الحالي** أولاً، وبعدين المسافة — مش بديل عن المسافة، فني أعلى
   * مستوى/أقل حِمل بياخد أولوية جوّه نفس دائرة المؤهلين مش إنه يتجاهل المسافة تماماً. المسافة
   * بتتحسب فعلياً بـ PostGIS (ST_Distance على geography) — مش تقريب.
   *
   * **موازنة الحِمل (ADR-0018 §7، طلب صريح من المالك 2026-08-19)**: بعد ما الفني بقى متاح
   * افتراضيًا (ADR-0017 بند 3)، كل الفنيين المؤهلين بقوا "مرشّحين" دايمًا — من غير توازن، أعلى
   * فني مستوى/أقرب هياخد كل الطلبات على طول رغم إن فنيين تانيين مؤهلين بنفس القدر بس أقل انشغالاً.
   * `workload.active_count` (LATERAL subquery تحت) بيعدّ طلبات الفني النشطة دلوقتي فعليًا
   * (`ACTIVE_TECHNICIAN_ORDER_STATUSES` — بما فيها المقبولة ولسه ما بدأتش، مش بس الجاري تنفيذها).
   * الحِمل ده بيتطرح من `order_priority_weight` بوزن قابل للتعديل (`matching.workload_balance_weight`،
   * افتراضي 2) قبل الترتيب — **إضافة على معايير الترتيب الموجودة، مش استبدال ليها** (لسه جوّه نفس
   * بنية `ORDER BY` الموجودة، مش قاعدة منفصلة "أقل عدد طلبات يفوز دايمًا"): فرق مستوى كبير (مثلاً
   * `premium` وزن 30 مقابل `professional` وزن 20) لسه بيغلب فرق حِمل معقول، لكن بين فنيين متقاربين
   * في المستوى، اللي عنده حِمل أقل بياخد الأولوية. تعديل `matching.workload_balance_weight` لصفر
   * بيرجّع للسلوك القديم بالحرف (تعطيل موازنة الحِمل بلا تغيير كود).
   *
   * **بَقّة حقيقية اتلقطت واتصلحت وقت اختبار حي لميزة تانية (خرائط/ملاحة apps/technician-app)**:
   * الاستعلام مكانش بيستبعد فني عنده أصلاً طلب نشط (accepted/technician_on_way/...) — يعني نفس
   * الفني ممكن يتعرض عليه ويقبل أكتر من طلب نشط في نفس الوقت، رغم إن order-tracking.gateway.ts
   * و`GET /technician/orders/active` الاتنين بيفترضوا ضمنياً (`findOne` مش `find`) إن الفني عنده
   * طلب نشط واحد بس. اتأكدت البَقّة حياً: نفس الفني قَبِل 4 طلبات "accepted" متزامنة فعلياً في
   * الـ DB، وده خلّى بث الموقع اللحظي (`technician:location`) يوصل لغرفة الطلب الغلط (أقدم طلب
   * نشط عشوائياً، مش الطلب اللي العميل بيتابعه فعلياً) — عميل واحد استنى تحديث الموقع ومكانش
   * هيوصله أبداً. الإصلاح: استبعاد أي فني عنده طلب في `ACTIVE_TECHNICIAN_ORDER_STATUSES` بالفعل
   * من قائمة المؤهلين من الأساس — نفس مصدر الحقيقة الوحيد المستخدم في order-state-machine.ts.
   *
   * **بَقّة تانية اتلقطت واتصلحت (2026-08-13، موثّقة سابقًا في assistant-matching/README.md)**:
   * استعلام الاستبعاد فوق ماكانش بيفلتر `deleted_at IS NULL` — لو صف طلب اتعمله soft-delete
   * (نادر، مش مسار عادي) لكن `order_status` فضل على قيمة نشطة، الفني كان بيفضل "محبوس" كمشغول
   * للأبد رغم إن الطلب نفسه مش ظاهر لحد. اتضافت `AND deleted_at IS NULL` على نفس الاستعلام.
   */
  /**
   * `requestedTechnicianId` (اختياري، "إعادة الحجز") — بيقيّد النتيجة لفني واحد بس لو اتبعت،
   * نفس شروط الأهلية العادية بالظبط (خدمة/منطقة/متاح/معتمد/مش مشغول). لو رجعت فاضية، الكولر
   * (`dispatchNextRound`) مسؤول يرجع يسأل من غير القيد ده بدل ما يعتبرها "مفيش فنيين خالص".
   *
   * `ignoreAvailabilityFilter` — **بقى no-op بالكامل (ADR-0017 بند 3)**. كان بيتحكم في تجاهل
   * `is_available`/`is_on_duty`، لكن العمودين دول اتشالوا من الأهلية للكل (مش بس الطوارئ) —
   * الفني متاح افتراضيًا Opt-out، مش محتاج زرار يدوسه كل يوم. متسيّب في التوقيع بس عشان الـcaller
   * (بث الطوارئ) موجود من زمان، حذفه من التوقيع نفسه تنظيف تجميلي مؤجَّل لسيشن منفصلة.
   *
   * `preferredCompanyId` (docs/06 §1.5 — "اعتماد" بشركة محدّدة) — بيقيّد النتيجة لفنيي نفس
   * الشركة بس لو اتبعت، نفس فلسفة `requestedTechnicianId` بالحرف (تفضيل بس، مش ضمان — لو
   * الشركة مالهاش حد مؤهّل متاح، `dispatchNextRound` يرجع يسأل من غير القيد).
   *
   * **توافر الفني (ADR-0017 — نموذج Opt-out كامل، 2026-08-19، مُصحَّحة بـADR-0018 نفس اليوم لاحقًا)**:
   * `technicianAvailabilityCondition()` (`technician-eligibility.sql.ts`) هي المصدر الوحيد
   * المشترك مع `listForServiceBooking()` و`assertEligible()`. القاعدة الحالية: طلب ASAP عادي (مش
   * طوارئ) بيستبعد فني عنده طلب نشط دلوقتي بالفعل بالمعنى الأوسع؛ طلب طوارئ يستبعد بس لو الفني
   * *منشغل جسديًا فعليًا دلوقتي* (`ENGAGED_TECHNICIAN_ORDER_STATUSES` — طلب مقبول بس لسه ما بداش
   * ميستبعدش، ADR-0018 §9)؛ طلب مجدول (دايمًا غير طوارئ) بيستبعد بس لو فيه طلب تاني *بموعد نفس
   * اليوم بتوقيت مصر* والشغل شاغل يوم كامل (ADR-0018 §2 — الجدولة باليوم مش بالساعة، `matching
   * .full_day_job_minutes`)؛ وأي استثناء `blocked` صريح حدده الفني بنفسه في جدوله.
   */
  // مش private عمدًا (docs/08 §36.6) — MatchingExplainabilityService بيعيد استخدامها بالحرف
  // (batchSize كبير) عشان يحسب rank_score/ترتيب فني معيّن بين المرشّحين المؤهّلين الحقيقيين، بدل
  // ما يخترع صيغة ترتيب موازية في التفسير. الموديولين مسجّلين في نفس MatchingModule، صفر دورة.
  async findEligibleTechnicians(
    order: Order,
    batchSize: number,
    requestedTechnicianId?: string | null,
    ignoreAvailabilityFilter = false,
    preferredCompanyId?: string | null,
    ignoreActiveOrderConflict = false,
  ): Promise<EligibleTechnicianRow[]> {
    const fullDayJobMinutes = await this.settingsService.getNumber(
      'matching.full_day_job_minutes',
      FULL_DAY_JOB_MINUTES_FALLBACK,
    );
    const workloadBalanceWeight = await this.settingsService.getNumber(
      'matching.workload_balance_weight',
      WORKLOAD_BALANCE_WEIGHT_FALLBACK,
    );
    const fairnessLookbackDays = await this.settingsService.getNumber(
      'matching.fairness_lookback_days',
      FAIRNESS_LOOKBACK_DAYS_FALLBACK,
    );
    const fairnessWeight = await this.settingsService.getNumber('matching.fairness_weight', FAIRNESS_WEIGHT_FALLBACK);
    const fairnessDeclineWeight = await this.settingsService.getNumber(
      'matching.fairness_decline_weight',
      FAIRNESS_DECLINE_WEIGHT_FALLBACK,
    );
    // docs/08 §36.20-21، ADR-0023 — وزن الموثوقية (تقييم الفني)، معطّل افتراضيًا (0) زي fairness_weight
    // بالظبط. فني عنده تقييمات أقل من الحد الأدنى بيتحسب محايد (صفر تأثير)، مش معاقَب على قلة بيانات.
    const reliabilityWeight = await this.settingsService.getNumber('matching.reliability_weight', RELIABILITY_WEIGHT_FALLBACK);
    const reliabilityBaselineRating = await this.settingsService.getNumber(
      'matching.reliability_baseline_rating',
      RELIABILITY_BASELINE_RATING_FALLBACK,
    );
    const reliabilityMinRatingsCount = await this.settingsService.getNumber(
      'matching.reliability_min_ratings_count',
      RELIABILITY_MIN_RATINGS_COUNT_FALLBACK,
    );
    const candidates = await this.dataSource.query<EligibleTechnicianRow[]>(
      `
      SELECT tp.id AS technician_id,
             ST_Distance(tp.current_location, a.location) / 1000.0 AS distance_km,
             (
               COALESCE(tlc.order_priority_weight, 0)
               - COALESCE(workload.active_count, 0) * $14::int
               - COALESCE(fairness.recent_effective_workload, 0) * $15::numeric
               + (
                 CASE WHEN tp.total_ratings_count >= $22::int
                   THEN (tp.average_rating - $21::numeric) * $20::numeric
                   ELSE 0
                 END
               )
             ) AS rank_score,
             COALESCE(tlc.order_priority_weight, 0) AS priority_component,
             COALESCE(workload.active_count, 0) * $14::int AS workload_penalty,
             COALESCE(fairness.recent_effective_workload, 0) * $15::numeric AS fairness_penalty,
             (
               CASE WHEN tp.total_ratings_count >= $22::int
                 THEN (tp.average_rating - $21::numeric) * $20::numeric
                 ELSE 0
               END
             ) AS reliability_adjustment
      FROM technician_profiles tp
      -- ADR-0018 §8 — LEFT JOIN بدل INNER: أهلية الفني بقت "خدمة معتمدة مباشرة (ts) OR فئة
      -- الخدمة معتمدة (technician_categories، شرط الـEXISTS تحت في WHERE)" — فني معتمد بمستوى
      -- الفئة كلها (سباكة/كهرباء/...) بلا صف technician_services مباشر لنفس الخدمة دي بالذات
      -- لازم يفضل مؤهّل للمطابقة الفعلية.
      LEFT JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = $1 AND ts.is_active = true
        AND ts.verification_status = 'approved'
      JOIN technician_zones tz ON tz.technician_id = tp.id AND tz.service_zone_id = $2 AND tz.is_active = true
      JOIN addresses a ON a.id = $3
      JOIN services s ON s.id = $1
      LEFT JOIN technician_level_config tlc ON tlc.level = tp.current_level
      -- ADR-0018 §7 — حِمل الفني الحالي (عدد الطلبات النشطة عليه دلوقتي) لغرض موازنة التوزيع
      -- في الـORDER BY تحت. LATERAL بدل subquery عادي في SELECT عشان يتحسب مرة واحدة لكل فني
      -- مرشّح بس (بعد كل شروط WHERE)، مش لكل صف technician_profiles في الجدول كله.
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS active_count
        FROM orders wo
        WHERE wo.technician_id = tp.id
          AND wo.order_status = ANY($6::order_status[])
          AND wo.deleted_at IS NULL
      ) workload ON true
      -- docs/08 §34.2، ADR-0020 §6 — "توزيع حديث": عدد الطلبات اللي اتأكدت للفني في نافذة الأيام
      -- الأخيرة (لازم technician_id + assigned_at، مش بس "نشط دلوقتي" زي workload فوق) + الفرص
      -- المرفوضة الحديثة (order_assignments المرفوضة + technician_work_opportunities المرفوضة)
      -- بوزن أخف (fairness_decline_weight) — رفض الفرصة مش عقاب كامل، بس مش بلا أثر خالص برضه
      -- (منع فني من الحفاظ على أفضلية "مش شغال" مصطنعة برفض كل حاجة تتعرض عليه).
      LEFT JOIN LATERAL (
        SELECT
          (
            (SELECT COUNT(*) FROM orders ro WHERE ro.technician_id = tp.id AND ro.assigned_at >= now() - ($16 || ' days')::interval AND ro.deleted_at IS NULL)
            + $17::numeric * (
              (SELECT COUNT(*) FROM order_assignments roa WHERE roa.technician_id = tp.id AND roa.assignment_status = 'rejected' AND roa.sent_at >= now() - ($16 || ' days')::interval)
              + (SELECT COUNT(*) FROM technician_work_opportunities rwo WHERE rwo.technician_id = tp.id AND rwo.status = 'declined' AND rwo.offered_at >= now() - ($16 || ' days')::interval AND rwo.deleted_at IS NULL)
            )
          ) AS recent_effective_workload
      ) fairness ON true
      WHERE tp.verification_status = 'approved'
        -- ADR-0018 §8 — التأهيل الأساسي: technician_services المباشر (LEFT JOIN فوق) أو تأهيل
        -- بمستوى الفئة كلها (technician_categories).
        AND (
          ts.id IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM technician_categories tc
            WHERE tc.technician_id = tp.id AND tc.category_id = s.category_id
              AND tc.is_active = true AND tc.verification_status = 'approved'
          )
        )
        -- ADR-0017 بند 3 — is_available/is_on_duty اتشالوا من الأهلية بالكامل (الفني متاح
        -- افتراضيًا Opt-out، مش محتاج يدوس زرار كل يوم). $8 (ignoreAvailabilityFilter) بقى
        -- no-op فعليًا، متسيّب في التوقيع بس (استخدامه القديم كان مقصور على ده بالظبط) — الشرط
        -- التالت ده تعبير دايمًا صحيح (tautology) بس عشان Postgres يقدر يستنتج نوع $8 أصلاً
        -- (parameter من غير أي إشارة ليه بيرمي "could not determine data type").
        AND ($8::boolean IS NULL OR $8::boolean IS NOT NULL)
        AND tp.current_location IS NOT NULL
        AND tp.deleted_at IS NULL
        AND tp.id NOT IN (SELECT technician_id FROM order_assignments WHERE order_id = $4)
        AND ($7::uuid IS NULL OR tp.id = $7)
        AND ($9::uuid IS NULL OR tp.company_id = $9)
        -- بَقّة حقيقية اتلقطت وقت تحقيق §36.1 (docs/08، تعميق تسجيل موبايل حقيقي): الاستعلام ده
        -- كان بيكتشف الفني كمرشّح حتى لو مستواه مالوش حد قرار (decision_limit_cents) يكفي قيمة
        -- الطلب — نفس القاعدة اللي assertEligible() (technician-assignment-guard.service.ts)
        -- بيطبّقها وقت التأكيد بالظبط، بس هناك بعد ما الفني اتختار بالفعل كـlightPick. النتيجة:
        -- الفني الوحيد المؤهّل (خدمة/منطقة/توفر) بيترشّح بسبب المسافة/الأولوية، يوصل لآخر خطوة،
        -- assertEligible() يرميه، وautoConfirmScheduledOrder() بيرجّع 'stalled' فورًا من غير أي
        -- محاولة تانية — يعني الطلب "مفيهوش فني" تمامًا، حتى لو فيه فنيين تانيين مؤهّلين فعليًا
        -- (مستوى أعلى) كانوا هيعدّوا الفحص لو وصلولهم الدور. فني NEW حقيقي (مستوى افتراضي لأي
        -- تسجيل جديد، حد قرار 200 جنيه) وطلب "تسليك مواسير" (300 جنيه ثابت) بيكرروا البَقّة دي
        -- بالظبط — مش خاص بمسار التسجيل (fixture بنفس المستوى بيقع في نفس المشكلة تمامًا، اتأكد
        -- حي في mobile-signup-technician-parity.spec.ts). فلترة الاستعلام هنا (مصدر حقيقة واحد
        -- مع assertEligible()) بدل ما نسيب الاكتشاف أعمى وبعدين نفشل بصمت وقت التأكيد.
        AND EXISTS (
          SELECT 1 FROM technician_level_config dlc
          WHERE dlc.level = tp.current_level
            AND (dlc.decision_limit_cents IS NULL OR dlc.decision_limit_cents >= $18::int)
        )
        -- docs/08 §38 (طلب مالك صريح 2026-08-21) — طلبات "اعتماد" لازم قائدها (فني الطلب) يكون
        -- مستواه مؤهّل (technician_level_config.eligible_for_team_booking، افتراضيًا محترف فأعلى) —
        -- نفس فلسفة فلترة decision_limit_cents فوق بالحرف: مصدر حقيقة واحد مع assertCoreEligibility()
        -- (technician-assignment-guard.service.ts)، بدل ما نسيب التوزيع التلقائي يكتشف فني اعتماد
        -- غير مؤهّل وبعدين يفشل بصمت وقت التأكيد النهائي. individual/emergency ($19=false) بلا أي تغيير.
        AND ($19::boolean IS NOT TRUE OR tlc.eligible_for_team_booking = true)
        ${technicianAvailabilityCondition({
          technicianIdExpr: 'tp.id',
          scheduledAtParam: '$10',
          excludeOrderIdParam: '$4',
          activeStatusesParam: '$6',
          engagedStatusesParam: '$11',
          isEmergencyParam: '$12',
          serviceDurationExpr: "COALESCE((SELECT o2.duration_hours * 60 FROM orders o2 WHERE o2.id = $4::uuid), COALESCE(s.estimated_duration_minutes, 60), 60)",
          fullDayThresholdMinutesParam: '$13',
          ignoreActiveOrderConflict,
        })}
      ORDER BY rank_score DESC,
               distance_km ASC
      LIMIT $5
      `,
      [
        order.serviceId,
        order.serviceZoneId,
        order.addressId,
        order.id,
        batchSize,
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        requestedTechnicianId ?? null,
        ignoreAvailabilityFilter,
        preferredCompanyId ?? null,
        order.scheduledAt ?? null,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        order.bookingMode === BookingMode.EMERGENCY,
        fullDayJobMinutes,
        workloadBalanceWeight,
        fairnessWeight,
        String(fairnessLookbackDays),
        fairnessDeclineWeight,
        order.totalAmountCents,
        order.bookingMode === BookingMode.TEAM,
        reliabilityWeight,
        reliabilityBaselineRating,
        reliabilityMinRatingsCount,
      ],
    );
    const tieBreakThreshold = await this.settingsService.getNumber('matching.tie_break_threshold', TIE_BREAK_THRESHOLD_FALLBACK);
    return this.applyTieBreak(candidates, tieBreakThreshold);
  }

  /**
   * كسر التعادل بين مرشّحين متقاربين (docs/08 §34.2، ADR-0020 §6، بند T من رسالة المالك — "avoid
   * permanent deterministic winners"). لو الفرق بين أعلى `rank_score` ومرشّحين تانيين أقل من
   * `threshold`، دول بيُعتبروا "متعادلين" — بدل ترتيب حتمي صارم بينهم، تشويش عشوائي موزون
   * (الأقرب لأعلى نتيجة وزنه أعلى — نفس فلسفة exponential/weighted sampling، مش عشوائية خام
   * غير مفسَّرة: النتائج الخام نفسها لسه محفوظة، الأدمن يقدر يشوفها). `threshold <= 0` (الافتراضي)
   * = تعطيل كامل، الترتيب الحتمي زي ما هو بالحرف.
   */
  private applyTieBreak(candidates: EligibleTechnicianRow[], threshold: number): EligibleTechnicianRow[] {
    if (threshold <= 0 || candidates.length < 2) return candidates;

    const maxScore = Number(candidates[0].rank_score);
    const tieEndIndex = candidates.findIndex((c) => maxScore - Number(c.rank_score) > threshold);
    const tieBandSize = tieEndIndex === -1 ? candidates.length : tieEndIndex;
    if (tieBandSize < 2) return candidates;

    const tieBand = candidates.slice(0, tieBandSize);
    const rest = candidates.slice(tieBandSize);
    const shuffled = tieBand
      .map((candidate) => {
        const weight = 1 / (1 + (maxScore - Number(candidate.rank_score)));
        // مفتاح عشوائي موزون (exponential sampling) — احتمالية الظهور الأول بتتناسب مع الوزن،
        // بلا الحاجة لخوارزمية reservoir كاملة (الدفعة هنا صغيرة أصلاً، batch_size محدود).
        const key = -Math.log(Math.random()) / weight;
        return { candidate, key };
      })
      .sort((a, b) => a.key - b.key)
      .map((entry) => entry.candidate);

    return [...shuffled, ...rest];
  }

  /**
   * بيتصل بيها لحظة إنشاء الطلب (أول جولة)، وبعدها لما جولة تفشل بالكامل (كل الفنيين رفضوا/متأخرين).
   *
   * **إصلاح سباق حقيقي (مراجعة booking flow الشاملة 2026-08-12)**: قبل كده الدالة دي كانت بتقرأ
   * الطلب من غير قفل، فلو `reject()` (آخر عرض معلّق بيترفض) و`MatchingRoundExpiryProcessor`
   * (مهلة الجولة خلصت) نادوا الدالة دي في نفس اللحظة تقريبًا لنفس الطلب، الاتنين كانوا يقدروا
   * يقروا نفس `MAX(assignment_round)` قبل ما أي واحد يكتب، ويحسبوا نفس `nextRound`، ويضيفوا
   * صفوف `order_assignments` مكررة لنفس الجولة (فنيين اتبعتلهم عرض مرتين) — موثّقة بالتفصيل في
   * matching/README.md. الإصلاح: **قفل ذرّي (`pessimistic_write`) على صف الطلب من أول خطوة**،
   * نفس نمط `accept()` بالظبط — أي نداء تاني لنفس الطلب بيستنى القفل يتفك، وبعدين بيعيد قراءة
   * الحالة الحقيقية (لو الأول خلّص الجولة، التاني هيشوف الحالة الجديدة مش القديمة). كل القراءة/
   * الكتابة (حساب الجولة، البحث عن مؤهّلين، إدراج الصفوف) بقت جوّه نفس الـtransaction اللي ماسكة
   * القفل — `cancelForNoTechnicians` بقت بتاخد نفس الـmanager بدل ما تفتح transaction منفصلة
   * (كانت هتعمل deadlock: transaction تانية تحاول تقفل نفس صف الطلب اللي الأولى لسه ماسكاه).
   * الأحداث (إشعار/طابور المهلة) بتتبعت بعد ما الـtransaction تتقفل بنجاح بس، مش من جواها.
   */
  /**
   * **تصحيح جوهري (ADR-0018، طلب صريح من المالك 2026-08-19)** — بيلغي انقسام "قريب/بعيد" القديم
   * (ADR-0017 بند 7) بالكامل. الانقسام الصحيح هو **طوارئ/مجدول**: بس الطوارئ (استجابة فورية
   * بالتعريف) محتاجة دورة طلب/قبول-رفض فعلية. أي طلب تاني — عادي أو "Quick Job" (شغل صغير، مش
   * عاجل، ممكن يتطلب بكرة أو الأسبوع الجاي) — بيتبع نموذج الحجز المجدول العادي (تأكيد تلقائي بلا
   * انتظار قبول)، بغض النظر عن قرب/بُعد اليوم المطلوب.
   */
  private isEmergencyOrder(order: Pick<Order, 'bookingMode'>): boolean {
    return order.bookingMode === BookingMode.EMERGENCY;
  }

  /**
   * نقطة الدخول الموحّدة — كل نداء خارجي (OrderDispatchListener، MatchingRecoveryService.sweep)
   * لازم يستخدم دي بدل `dispatchNextRound()` مباشرة، عشان القرار "طوارئ/مجدول" يتاخد مرة واحدة
   * بس في مكان واحد. `reject()` الداخلية بتفضل تنادي `dispatchNextRound()` مباشرة عمدًا — لو فيه
   * `order_assignments` أصلاً معناه الطلب طوارئ بالفعل (المجدول ماليهوش assignments خالص).
   */
  async dispatchOrAutoConfirm(orderId: string): Promise<{ dispatched: number }> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order || order.orderStatus !== OrderStatus.SEARCHING_TECHNICIAN) {
      return { dispatched: 0 };
    }
    if (this.isEmergencyOrder(order)) {
      return this.dispatchNextRound(orderId);
    }
    return this.autoConfirmScheduledOrder(orderId);
  }

  async dispatchNextRound(orderId: string): Promise<{ dispatched: number }> {
    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();
      if (!order || order.orderStatus !== OrderStatus.SEARCHING_TECHNICIAN || !order.serviceZoneId) {
        return { kind: 'noop' as const };
      }

      // Reconciliation and duplicate process-local events may call this method
      // concurrently. The order lock serializes them; this reread prevents the
      // second caller from creating another round while the first round is live.
      const liveAssignments = await manager
        .createQueryBuilder(OrderAssignment, 'assignment')
        .where('assignment.orderId = :orderId', { orderId })
        .andWhere('assignment.assignmentStatus IN (:...statuses)', {
          statuses: [AssignmentStatus.SENT, AssignmentStatus.VIEWED],
        })
        .andWhere('assignment.expiresAt > :now', { now: new Date() })
        .getCount();
      if (liveAssignments > 0) {
        return { kind: 'noop' as const };
      }

      const { max } = (await manager
        .createQueryBuilder(OrderAssignment, 'a')
        .select('MAX(a.assignmentRound)', 'max')
        .where('a.orderId = :orderId', { orderId })
        .getRawOne<{ max: number | null }>()) ?? { max: null };
      const nextRound = (max ?? 0) + 1;

      const maxRounds = await this.settingsService.getNumber('matching.max_rounds', MAX_ROUNDS_FALLBACK);
      if (nextRound > maxRounds) {
        return { kind: 'stalled' as const, order, notifyNoTechnician: nextRound === 1 };
      }

      // هيكل الحجز الجديد (docs/06 §1.7) — "طوارئ" بتستخدم دفعة أكبر (افتراضي 10، "أول عشرة"
      // بالحرف من كلام المالك) وبتتجاهل فلتر التوافر العادي تمامًا (تفاصيل في findEligibleTechnicians).
      const isEmergency = this.isEmergencyOrder(order);

      // سقف أقصى لإجمالي الفنيين المتواصَل معاهم عبر كل الجولات (docs/08 §17.15، طوارئ بس) —
      // مستقل عن matching.max_rounds (ده بيحدّ عدد *الجولات*، ده بيحدّ عدد *الفنيين* الكلي).
      // بيتحسب قبل أي إدراج للجولة دي، فبيمثّل "اتصلنا بكام فني لحد دلوقتي فعلاً".
      let techniciansContactedSoFar = 0;
      let emergencyRemainingBudget: number | null = null;
      if (isEmergency) {
        techniciansContactedSoFar = await manager.count(OrderAssignment, { where: { orderId } });
        const maxContacted = await this.settingsService.getNumber(
          'matching.emergency_max_technicians_contacted',
          EMERGENCY_MAX_TECHNICIANS_CONTACTED_FALLBACK,
        );
        emergencyRemainingBudget = maxContacted - techniciansContactedSoFar;
        if (emergencyRemainingBudget <= 0) {
          return { kind: 'stalled' as const, order, notifyNoTechnician: nextRound === 1 };
        }
      }

      // دفعة أولى/تالية منفصلتين (docs/08 §17.15) — الأدمن يقدر يخلّي أول دفعة أكبر (سرعة أولية)
      // ودفعات لاحقة أصغر (أو العكس)، بلا افتراض إن الدفعتين لازم يبقوا بنفس الحجم.
      let batchSize: number;
      if (isEmergency) {
        batchSize =
          nextRound === 1
            ? await this.settingsService.getNumber('matching.emergency_batch_size', EMERGENCY_BATCH_SIZE_FALLBACK)
            : await this.settingsService.getNumber(
                'matching.emergency_subsequent_batch_size',
                EMERGENCY_SUBSEQUENT_BATCH_SIZE_FALLBACK,
              );
        if (emergencyRemainingBudget !== null) {
          batchSize = Math.min(batchSize, emergencyRemainingBudget);
        }
      } else {
        batchSize = await this.settingsService.getNumber('matching.batch_size', BATCH_SIZE_FALLBACK);
      }
      // "إعادة الحجز": أول جولة بس بتحاول تعرض على الفني المطلوب حصرياً. لو مش متاح دلوقتي
      // (مشغول/مش أونلاين/إلخ)، نرجع فوراً للتوزيع العادي لنفس الجولة — التفضيل بيتجاهَل بأمان،
      // الطلب مش بيتلغي بسبب إن فني واحد بالذات مش متاح.
      let candidates =
        nextRound === 1 && order.requestedTechnicianId
          ? await this.findEligibleTechnicians(order, batchSize, order.requestedTechnicianId, isEmergency)
          : [];
      // "اعتماد" بشركة محدّدة (docs/06 §1.5، docs/07 الجزء أ — كانت فجوة موثّقة صراحة، اتقفلت):
      // أول جولة بس بتحاول تعرض حصريًا على فنيي الشركة المطلوبة. لو محدش مؤهّل متاح فيها، بيرجع
      // فوراً للتوزيع العادي — نفس فلسفة "إعادة الحجز" بالحرف، تفضيل مش ضمان.
      if (candidates.length === 0 && nextRound === 1 && order.requestedTechnicianCompanyId) {
        candidates = await this.findEligibleTechnicians(
          order,
          batchSize,
          null,
          isEmergency,
          order.requestedTechnicianCompanyId,
        );
      }
      if (candidates.length === 0) {
        candidates = await this.findEligibleTechnicians(order, batchSize, null, isEmergency);
      }
      // ADR-0017 بند 10 — Fallback توسيع النطاق: لو نضبت قايمة الفنيين "المثاليين" (مؤهلين
      // ومتاحين فعلاً) وعدّينا جولة العتبة القابلة للإعداد، نوسّع البحث لفنيين مؤهلين لنفس
      // الخدمة/المنطقة لكن مشغولين حاليًا بطلب تاني — أفضل من طلب عالق بلا أي محاولة، وأفضل من
      // بث عشوائي لفني مش متخصص. مقصورة على طلبات ASAP (الاستبعاد بتاعها هو "مشغول دلوقتي" —
      // الطلبات المجدولة أصلاً بتتعارض بس مع تداخل زمني حقيقي، توسيعها هيسمح بحجز مزدوج فعلي).
      if (candidates.length === 0 && !order.scheduledAt && !isEmergency) {
        const broadenAfterRound = await this.settingsService.getNumber(
          'matching.broaden_to_busy_after_round',
          BROADEN_TO_BUSY_AFTER_ROUND_FALLBACK,
        );
        if (nextRound >= broadenAfterRound) {
          candidates = await this.findEligibleTechnicians(order, batchSize, null, false, null, true);
        }
      }
      // قرار عمل صريح من المالك (2026-08-19) — مفيش إلغاء تلقائي خالص لمجرد مفيش فني اتلاقاله
      // دلوقتي. الطلب يفضل SEARCHING_TECHNICIAN بلا أي assignment جديد الجولة دي —
      // MatchingRecoveryService.sweep() (بتشتغل كل دقيقة، مستقلة تمامًا) بتعيد نداء
      // dispatchNextRound() تلقائيًا طالما مفيش assignment حي، فأول ما فني يبقى مؤهّل ومتاح
      // (توفر جديد، خدمة/منطقة اتضافتله، إلخ) الطلب بيتوزّع عليه من غير أي تدخل يدوي.
      if (candidates.length === 0) {
        return { kind: 'stalled' as const, order, notifyNoTechnician: nextRound === 1 };
      }

      // مهلة رد أقصر للطوارئ (docs/08 §17.15 — "عمر العرض") — استعجال حقيقي، مستقلة عن مهلة
      // الطلب العادي تمامًا.
      const responseTimeoutSeconds = isEmergency
        ? await this.settingsService.getNumber(
            'matching.emergency_response_timeout_seconds',
            EMERGENCY_RESPONSE_TIMEOUT_SECONDS_FALLBACK,
          )
        : await this.settingsService.getNumber('matching.response_timeout_seconds', RESPONSE_TIMEOUT_SECONDS_FALLBACK);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + responseTimeoutSeconds * 1000);
      const rows = candidates.map((c) =>
        manager.create(OrderAssignment, {
          orderId: order.id,
          technicianId: c.technician_id,
          assignmentRound: nextRound,
          distanceKm: c.distance_km,
          assignmentStatus: AssignmentStatus.SENT,
          sentAt: now,
          expiresAt,
        }),
      );
      await manager.save(rows);
      this.logger.log(`جولة ${nextRound} — ${rows.length} فني لطلب ${order.orderNumber}`);

      // تصعيد للأدمن/الموظف (docs/08 §17.15 — "سياسة تصعيد") — مرة واحدة بس لكل طلب، لما عدد
      // الجولات يوصل لعتبة قابلة للتعديل، قبل ما يوصل لسقف الجولات/الفنيين ويتلغي تلقائي.
      let shouldEscalate = false;
      if (isEmergency) {
        const escalationAfterRounds = await this.settingsService.getNumber(
          'matching.emergency_escalation_after_rounds',
          EMERGENCY_ESCALATION_AFTER_ROUNDS_FALLBACK,
        );
        shouldEscalate = nextRound === escalationAfterRounds;
      }

      return {
        kind: 'dispatched' as const,
        order,
        nextRound,
        responseTimeoutSeconds,
        dispatched: rows.length,
        rows,
        isEmergency,
        sentAt: now,
        expiresAt,
        shouldEscalate,
        techniciansContactedSoFar: techniciansContactedSoFar + rows.length,
      };
    });

    if (result.kind === 'noop') {
      return { dispatched: 0 };
    }
    if (result.kind === 'stalled') {
      if (result.notifyNoTechnician) this.emitNoTechniciansFound(result.order);
      return { dispatched: 0 };
    }

    if (result.shouldEscalate) {
      this.events.emit(
        ORDER_EMERGENCY_DISPATCH_STRUGGLING_EVENT,
        new OrderEmergencyDispatchStrugglingEvent(
          result.order.id,
          result.order.orderNumber,
          result.nextRound,
          result.techniciansContactedSoFar,
        ),
      );
    }

    // بره الـ transaction عمداً (زي ORDER_ACCEPTED_EVENT) — مفيش داعي حد يسمع بيانات مش مؤكّدة.
    // docs/08 §17.16 — عرض طلب لكل فني، عادي أو طوارئ (isEmergency)، المستمع (notifications
    // module) هو اللي بيقرر القناة/الأولوية الفعلية.
    for (const row of result.rows) {
      this.events.emit(
        ORDER_OFFER_CREATED_EVENT,
        new OrderOfferCreatedEvent(row.id, result.order.id, result.order.orderNumber, row.technicianId, result.isEmergency, result.sentAt, result.expiresAt),
      );
    }

    // مهلة حقيقية مجدولة (مش انتظار سلبي) — لو محدش رد (لا قبول ولا رفض صريح) خلال
    // responseTimeoutSeconds، الـ processor بيقفل الجولة دي ويبعت التالية أوتوماتيك.
    // jobId ثابت (orderId:round) يمنع أي تكرار لو dispatchNextRound اتنادى مرتين بالغلط لنفس الجولة.
    await this.roundsQueue.add(
      ROUND_EXPIRED_JOB,
      { orderId: result.order.id, round: result.nextRound },
      { delay: result.responseTimeoutSeconds * 1000, jobId: roundExpiredJobId(result.order.id, result.nextRound) },
    );

    return { dispatched: result.dispatched };
  }

  // قرار عمل صريح من المالك (2026-08-19، §26.2) — قبل كده الدالة دي كانت بتلغي الطلب فعليًا
  // (CANCELLED_BY_SYSTEM) لمجرد مفيش فني اتلاقاله. المالك أكّد صراحة (بلاغين منفصلين، ده تاني
  // واحد) إنه مش عايز أي إلغاء تلقائي للنظام خالص — الطلب يفضل SEARCHING_TECHNICIAN للأبد،
  // MatchingRecoveryService.sweep() (بتشتغل كل دقيقة، موجودة بالفعل) بتعيد المحاولة تلقائيًا،
  // وده بيتم فقط عبر إشعار (emitNoTechniciansFound تحت) — الحالة نفسها ما بتتغيرش خالص، فمفيش
  // حاجة تتحفظ هنا. نفس السبب اللي كان موجود قبل كده (deadlock لو فتحنا transaction منفصلة) —
  // الدالة القديمة اتشالت تمامًا بدل ما تتعدّل، مفيش أي DB write هنا خالص دلوقتي.
  private emitNoTechniciansFound(order: Order): void {
    this.events.emit(ORDER_NO_TECHNICIAN_FOUND_EVENT, new OrderNoTechnicianFoundEvent(order.id, order.orderNumber));
  }

  /**
   * تأكيد تلقائي لطلب مجدول (ADR-0018، مُصحَّحة فوق ADR-0017 بند 7 القديم — بقت شاملة **كل**
   * الطلبات غير الطوارئ، مش بس "البعيدة") — بدل انتظار قبول فني (`order_assignments`
   * SENT/VIEWED + مهلة رد)، بيدوّر عن أفضل فني مؤهّل واحد (نفس ترتيب `findEligibleTechnicians`،
   * أولوية مستوى ثم مسافة، ونفس تدرّج التفضيل "إعادة حجز → اعتماد شركة → عام" اللي
   * `dispatchNextRound` بتستخدمه) وبيأكّد الطلب ليه مباشرة — نفس انتقال الحالة اللي آخر `accept()`
   * بتعمله بالحرف، بس بـ`changeSource=system` (مفيش فني ضغط "قبول" فعليًا). صف `order_assignments`
   * واحد بحالة `accepted` بيتسجّل للتوثيق/الإحصائيات بس (مش "عرض" يستنى رد).
   *
   * لو مفيش فني مؤهّل، الطلب يفضل `SEARCHING_TECHNICIAN` بلا إلغاء (نفس قرار §26.2 الموجود) —
   * `MatchingRecoveryService.sweep()` هتعيد المحاولة بنفس المسار ده تلقائيًا.
   */
  /**
   * تأكيد فني على طلب داخل transaction مقفولة بالفعل (`manager` جاي من الـcaller، القفل على صف
   * الطلب اتاخد قبل النداء) — نفس منطق التأكيد التلقائي بالحرف، مستخرج كدالة مشتركة لأنه بقى
   * بيتنادى من مسارين دلوقتي (docs/08 §34.1b، ADR-0020 §4): التأكيد التلقائي لمرشّح `LIGHT`، وقبول
   * الفني الصريح لفرصة شغل إضافي (`acceptWorkOpportunity`).
   */
  // مساحة عمل الشركة (ADR-0033) — snapshot الشركة الحالية للفني وقت التعيين، مش استعلام حي.
  // بترجع null بأمان للفني المستقل (company_id=null) — نفس سلوك orders.assigned_company_id
  // الافتراضي لأي طلب فردي عادي. SQL مباشر عمدًا (مش techniciansService.findByProfileIdOrThrow)
  // — نفس نمط باقي الملف ده (استعلامات دقيقة صغيرة عبر this.dataSource)، وبيتجنّب حقن تبعية
  // جديدة على TechniciansService في مسار مُختبر بـstub خفيف (matching.service.spec.ts).
  private async resolveAssignedCompanyId(technicianId: string): Promise<string | null> {
    const rows = await this.dataSource.query<{ company_id: string | null }[]>(
      `SELECT company_id FROM technician_profiles WHERE id = $1`,
      [technicianId],
    );
    return rows[0]?.company_id ?? null;
  }

  private async confirmTechnicianForOrder(
    manager: EntityManager,
    order: Order,
    technicianId: string,
    distanceKm: string | null,
  ): Promise<{ kind: 'noop' } | { kind: 'confirmed'; order: Order; technicianId: string }> {
    const now = new Date();
    await manager.save(
      manager.create(OrderAssignment, {
        orderId: order.id,
        technicianId,
        assignmentRound: 1,
        distanceKm,
        assignmentStatus: AssignmentStatus.ACCEPTED,
        sentAt: now,
        respondedAt: now,
        expiresAt: now,
      }),
    );

    if (!canTransition(order.orderStatus, OrderStatus.TECHNICIAN_ASSIGNED)) {
      return { kind: 'noop' };
    }
    order.technicianId = technicianId;
    order.assignedCompanyId = await this.resolveAssignedCompanyId(technicianId);
    order.orderStatus = OrderStatus.TECHNICIAN_ASSIGNED;
    order.assignedAt = now;
    await manager.save(order);
    await manager.save(
      manager.create(OrderStatusHistory, {
        orderId: order.id,
        previousStatus: OrderStatus.SEARCHING_TECHNICIAN,
        newStatus: OrderStatus.TECHNICIAN_ASSIGNED,
        changedByUserId: null,
        changedByRole: 'system',
        changeSource: OrderChangeSource.SYSTEM,
      }),
    );

    order.orderStatus = OrderStatus.ACCEPTED;
    order.acceptedAt = now;
    await manager.save(order);
    await manager.save(
      manager.create(OrderStatusHistory, {
        orderId: order.id,
        previousStatus: OrderStatus.TECHNICIAN_ASSIGNED,
        newStatus: OrderStatus.ACCEPTED,
        changedByUserId: null,
        changedByRole: 'system',
        changeSource: OrderChangeSource.SYSTEM,
      }),
    );

    // أي فرصة شغل إضافي تانية حية لنفس الطلب بقت بلا معنى — الطلب اتغطى.
    await this.workOpportunities.closeRemainingForOrder(manager, order.id);

    return { kind: 'confirmed', order, technicianId };
  }

  /**
   * تصنيف القدرة الاستيعابية للمرشّح الأول قبل قرار التأكيد التلقائي (docs/08 §34.1b، ADR-0020
   * §1/§3) — مش بديل عن `findEligibleTechnicians()` (لسه المصدر الوحيد للأهلية الأساسية)، طبقة
   * قرار إضافية فوقه: `LIGHT` يتأكد تلقائيًا زي ما هو بالحرف، `MEANINGFUL`/`HEAVY` (لو الإعداد
   * سامح) بيتحول لفرصة اختيارية بدل تأكيد صامت.
   */
  private async classifyCandidate(order: Order, technicianId: string, fullDayJobMinutes: number): Promise<TechnicianCapacityTier> {
    const service = await this.dataSource.query<{ estimated_duration_minutes: number | null }[]>(
      `SELECT estimated_duration_minutes FROM services WHERE id = $1`,
      [order.serviceId],
    );
    const tier = await classifyTechnicianCapacity(this.dataSource, {
      technicianId,
      scheduledAt: order.scheduledAt,
      excludeOrderId: order.id,
      serviceDurationMinutes: service[0]?.estimated_duration_minutes ?? 60,
      fullDayThresholdMinutes: fullDayJobMinutes,
    });
    if (process.env.DEBUG_MATCHING) {
      // eslint-disable-next-line no-console
      console.log('[DEBUG tier]', technicianId, tier, 'candMinutes=', service[0]?.estimated_duration_minutes);
    }
    return tier;
  }

  async autoConfirmScheduledOrder(orderId: string): Promise<{ dispatched: number }> {
    // فرصة اختيارية حية موجودة بالفعل لنفس الطلب — منستنى قرار الفني، مش نعرض تاني/نأكّد تلقائي
    // (نفس فكرة liveAssignments في dispatchNextRound). لو الفني يرفض، الـcaller (endpoint الرفض)
    // بينادي dispatchOrAutoConfirm تاني بنفسه، فمفيش داعي sweep يعيد المحاولة هنا كل دقيقة.
    if (await this.workOpportunities.hasLiveOfferForOrder(orderId)) {
      return { dispatched: 0 };
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();
      if (!order || order.orderStatus !== OrderStatus.SEARCHING_TECHNICIAN || !order.serviceZoneId) {
        return { kind: 'noop' as const };
      }

      const fullDayJobMinutes = await this.settingsService.getNumber('matching.full_day_job_minutes', FULL_DAY_JOB_MINUTES_FALLBACK);
      const candidateBatchSize = await this.settingsService.getNumber('matching.batch_size', BATCH_SIZE_FALLBACK);

      let candidates = order.requestedTechnicianId
        ? await this.findEligibleTechnicians(order, 1, order.requestedTechnicianId, false)
        : [];
      if (candidates.length === 0 && order.requestedTechnicianCompanyId) {
        candidates = await this.findEligibleTechnicians(order, 1, null, false, order.requestedTechnicianCompanyId);
      }
      if (candidates.length === 0) {
        // دفعة (مش فني واحد بس) — عشان نقدر نلاقي أول مرشّح LIGHT فعلي بدل ما نقف عند أول واحد
        // في الترتيب لو هو المرشّح الوحيد اللي مش LIGHT (docs/08 §34.1b).
        candidates = await this.findEligibleTechnicians(order, candidateBatchSize, null, false);
      }
      // **بلا `return stalled` هنا لو candidates.length === 0** — دي بالظبط الحالة اللي محتاجة
      // fallback الـHEAVY توسيع البحث تحت (docs/08 §34.1b): الاستعلام الصارم (technicianAvailability
      // Condition()) بيستبعد فنيين HEAVY **بالكامل** من الأساس (مش بيرجعهم كمرشحين نصنّفهم بعدين) —
      // يعني لو الفني الوحيد المؤهّل HEAVY، `candidates` هنا بترجع فاضية تمامًا، مش "فيها فني
      // مصنّف HEAVY". لو رجّعنا stalled هنا زي الأول، fallback التوسيع تحت كان أبدًا مش هيتنفّذ.

      let lightPick: { technicianId: string; distanceKm: string } | null = null;
      let meaningfulPick: { technicianId: string; distanceKm: string } | null = null;
      for (const candidate of candidates) {
        const tier = await this.classifyCandidate(order, candidate.technician_id, fullDayJobMinutes);
        if (tier === 'LIGHT') {
          lightPick = { technicianId: candidate.technician_id, distanceKm: candidate.distance_km };
          break;
        }
        if (tier === 'MEANINGFUL' && !meaningfulPick) {
          meaningfulPick = { technicianId: candidate.technician_id, distanceKm: candidate.distance_km };
        }
      }

      if (process.env.DEBUG_MATCHING) {
        // eslint-disable-next-line no-console
        console.log('[DEBUG matching] candidates:', JSON.stringify(candidates), 'tiersChecked:', candidates.length);
      }
      if (!lightPick && !meaningfulPick) {
        // مفيش LIGHT ولا MEANINGFUL في الدفعة (كلهم HEAVY أو اتستبعدوا) — نجرّب توسيع البحث
        // (ignoreActiveOrderConflict، نفس آلية ADR-0017 §10) عشان نلاقي مرشّح HEAVY نعرضله فرصة،
        // لو الإعداد سامح بده.
        const offerHeavy = await this.settingsService.getBoolean('matching.offer_heavy_workload_technicians', true);
        if (offerHeavy) {
          const broadened = await this.findEligibleTechnicians(order, 1, null, false, null, true);
          if (broadened.length > 0) {
            const tier = await this.classifyCandidate(order, broadened[0].technician_id, fullDayJobMinutes);
            if (tier !== 'BLOCKED') {
              meaningfulPick = { technicianId: broadened[0].technician_id, distanceKm: broadened[0].distance_km };
            }
          }
        }
      }

      if (lightPick) {
        const technicianId = lightPick.technicianId;
        // دفاع عمق ضد سباق نادر (ADR-0017 بند 5 — نفس نمط accept() الموجود بالحرف): قفل صف الفني
        // نفسه وإعادة فحص الأهلية تحت القفل مباشرة قبل الكتابة.
        const lockedTechnician = await this.assignmentGuard.lockTechnician(manager, technicianId);
        try {
          await this.assignmentGuard.assertEligible(manager, lockedTechnician, order);
        } catch (err) {
          if (process.env.DEBUG_MATCHING) {
            // eslint-disable-next-line no-console
            console.log('[DEBUG assertEligible-fail]', err instanceof Error ? err.message : err);
          }
          return { kind: 'stalled' as const, order };
        }
        const confirmResult = await this.confirmTechnicianForOrder(manager, order, technicianId, lightPick.distanceKm);
        return confirmResult.kind === 'noop' ? { kind: 'noop' as const } : { kind: 'confirmed' as const, order, technicianId };
      }

      if (meaningfulPick) {
        const tier = await this.classifyCandidate(order, meaningfulPick.technicianId, fullDayJobMinutes);
        const opportunity = await this.workOpportunities.offerIfNotExists(manager, order.id, meaningfulPick.technicianId, tier);
        return { kind: 'offered' as const, order, technicianId: meaningfulPick.technicianId, opportunity };
      }

      return { kind: 'stalled' as const, order };
    });

    if (result.kind === 'noop') {
      return { dispatched: 0 };
    }
    if (result.kind === 'offered') {
      // بره الـtransaction عمداً (زي ORDER_ACCEPTED_EVENT تحت) — مفيش داعي حد يسمع بيانات مش
      // مؤكّدة. docs/08 §36.1 — created:false يعني الفرصة كانت موجودة بالفعل (idempotent
      // re-check)، مش عرض جديد فعليًا، فمفيش داعي إشعار مكرر.
      if (result.opportunity.created) {
        this.events.emit(
          WORK_OPPORTUNITY_OFFERED_EVENT,
          new WorkOpportunityOfferedEvent(
            result.opportunity.id,
            result.order.id,
            result.order.orderNumber,
            result.technicianId,
            'assignment',
            result.opportunity.capacity_tier_at_offer,
          ),
        );
      }
      return { dispatched: 0 };
    }
    if (result.kind === 'stalled') {
      this.emitNoTechniciansFound(result.order);
      return { dispatched: 0 };
    }

    this.events.emit(
      ORDER_ACCEPTED_EVENT,
      new OrderAcceptedEvent(result.order.id, result.order.customerId, result.technicianId, result.order.scheduledAt),
    );
    return { dispatched: 1 };
  }

  /**
   * قبول فرصة شغل إضافي (docs/08 §34.1b، ADR-0020 §4) — الفني بيدوس "قبول" على فرصة كان معروضة
   * عليه لأنه `MEANINGFUL`/`HEAVY` وقت العرض. **إعادة فحص كاملة تحت قفل قبل أي كتابة** — عرض
   * ظاهر مش ضمان إن القبول هيعدّي:
   *  1. قفل صف الفرصة نفسه (`FOR UPDATE`) — لازم تفضل `offered` (مش اتقبلت/اترفضت/اتقفلت من
   *     حدث تاني، زي تأكيد تلقائي لفني تاني أو انشغال الطلب بطريقة تانية).
   *  2. قفل صف الطلب (`pessimistic_write`) — لازم يفضل `SEARCHING_TECHNICIAN`.
   *  3. قفل صف الفني وإعادة فحص الأهلية الكاملة (`assignmentGuard.assertEligible`) — لو الفني
   *     بقى `BLOCKED` من وقت العرض (حظر يوم بنفسه مثلاً)، القبول يترفض بوضوح.
   */
  async acceptWorkOpportunity(userId: string, opportunityId: string): Promise<Order> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    const technicianId = profile.id;
    const result = await this.dataSource.transaction(async (manager) => {
      const opportunity = await this.workOpportunities.getOwnedOfferedOrThrow(manager, technicianId, opportunityId);
      // docs/08 §35، ADR-0021 §2 — الفرصة دي جدول مشترك مع تجنيد الفريق (context='crew_recruit')،
      // بس قبولها هنا معناها "تبقى قائد الطلب" — غلط تمامًا لعرض تجنيد فريق (قبوله لازم يضيف صف
      // order_team_members بدل ما يغيّر orders.technician_id). قبولها بيتم من OrderTeamService
      // .acceptCrewOpportunity() بدل كده.
      if (opportunity.context !== 'assignment') {
        throw new ApiException(ErrorCode.VAL_001, 'الفرصة دي مش من نوع تعيين قائد — استخدم مسار تجنيد الفريق', HttpStatus.BAD_REQUEST);
      }

      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId: opportunity.order_id })
        .getOne();
      if (!order || order.orderStatus !== OrderStatus.SEARCHING_TECHNICIAN) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب ده مش متاح دلوقتي — ممكن يكون اتغطى من فني تاني', HttpStatus.CONFLICT);
      }

      const lockedTechnician = await this.assignmentGuard.lockTechnician(manager, technicianId);
      await this.assignmentGuard.assertEligibleForWorkOpportunity(manager, lockedTechnician, order);

      const confirmResult = await this.confirmTechnicianForOrder(manager, order, technicianId, null);
      if (confirmResult.kind === 'noop') {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب ده مش متاح دلوقتي — ممكن يكون اتغطى من فني تاني', HttpStatus.CONFLICT);
      }
      await this.workOpportunities.markDecided(manager, opportunityId, 'accepted');

      return confirmResult;
    });

    this.events.emit(
      ORDER_ACCEPTED_EVENT,
      new OrderAcceptedEvent(result.order.id, result.order.customerId, result.technicianId, result.order.scheduledAt),
    );
    return result.order;
  }

  /**
   * رفض فرصة شغل إضافي — الفني قرر معندوش قدرة استيعابية حقيقية. الطلب يفضل `SEARCHING_TECHNICIAN`
   * بلا أي إعادة محاولة تلقائية فورية هنا (الـcaller/controller هو اللي بينادي
   * `dispatchOrAutoConfirm()` تاني بعد الرفض، عشان مرشّح تاني ياخد فرصة — نفس فلسفة `reject()`
   * الموجودة للطوارئ، لكن هنا مفيش جولة/expiry، القرار الفني وحده هو المحرّك).
   */
  async declineWorkOpportunity(userId: string, opportunityId: string): Promise<{ orderId: string }> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    const result = await this.dataSource.transaction(async (manager) => {
      const opportunity = await this.workOpportunities.getOwnedOfferedOrThrow(manager, profile.id, opportunityId);
      if (opportunity.context !== 'assignment') {
        throw new ApiException(ErrorCode.VAL_001, 'الفرصة دي مش من نوع تعيين قائد — استخدم مسار تجنيد الفريق', HttpStatus.BAD_REQUEST);
      }
      await this.workOpportunities.markDecided(manager, opportunityId, 'declined');
      return { orderId: opportunity.order_id };
    });
    // الفني رفض — نديله فرصة تانية للمرشّح اللي بعده فورًا بدل ما نستنى sweep الدقيقة (نفس فلسفة
    // reject() الموجودة للطوارئ اللي بتنادي dispatchNextRound() على طول).
    await this.dispatchOrAutoConfirm(result.orderId);
    return result;
  }

  async listWorkOpportunitiesForUser(userId: string) {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    return this.workOpportunities.listForTechnician(profile.id);
  }

  /**
   * ADR-0018 §5 — العرض يفضل ظاهر هنا طالما `sent` (محدش قبله لسه)، **مهما كانت `expires_at`
   * فاتت أو لأ**. `expires_at` بقت معناها "امتى النظام بيوسّع البث لفنيين إضافيين" بس (راجع
   * matching-round-expiry.processor.ts) — مش ميعاد صلاحية للعرض نفسه. لو الفني فتح التطبيق بعد
   * ما البث اتوسّع لفنيين تانيين، لازم لسه يشوف الطلب ده في قايمته ويقدر يقبله (أول واحد يقبل
   * ياخده، exclusivity ذرّية في accept() تحت).
   */
  async listAvailableForTechnician(userId: string): Promise<AvailableOrderRow[]> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    return this.dataSource.query<AvailableOrderRow[]>(
      `
      SELECT oa.id AS assignment_id, o.id AS order_id, o.order_number, s.name_ar AS service_name_ar,
             o.problem_description, a.street_name, a.landmark, oa.distance_km, oa.expires_at
      FROM order_assignments oa
      JOIN orders o ON o.id = oa.order_id
      JOIN services s ON s.id = o.service_id
      JOIN addresses a ON a.id = o.address_id
      WHERE oa.technician_id = $1 AND oa.assignment_status = 'sent'
      ORDER BY oa.sent_at DESC
      `,
      [profile.id],
    );
  }

  /**
   * أول فني يقبل ياخده — قفل ذري (SELECT ... FOR UPDATE) على صف الطلب نفسه يمنع أي سباق:
   * أي محاولتين قبول متزامنتين، التانية بتستنى قفل الأولى، وبعد ما تفك بتلاقي الحالة اتغيّرت فترفض بأمان.
   */
  async accept(userId: string, orderId: string): Promise<Order> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);

    const order = await this.dataSource.transaction(async (manager) => {
      // Technician is the shared resource across different orders, so lock it before the order.
      const lockedTechnician = await this.assignmentGuard.lockTechnician(manager, profile.id);
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();

      if (!order) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
      }
      if (order.orderStatus !== OrderStatus.SEARCHING_TECHNICIAN) {
        throw new ApiException(ErrorCode.ORDR_003, 'الطلب اتاخد من فني تاني أو مبقاش متاح', HttpStatus.CONFLICT);
      }
      await this.assignmentGuard.assertEligible(manager, lockedTechnician, order);

      // ADR-0018 §5 — مفيش فحص expiresAt هنا عمدًا: العرض يفضل قابل للقبول طالما assignment_status
      // لسه sent/viewed (محدش قبله ولا هو رفضه صراحة)، بغض النظر عن مرور مهلة الجولة. راجع
      // matching-round-expiry.processor.ts للتفصيل الكامل — expiresAt بقت بس تريجر لتوسيع البث،
      // مش ميعاد صلاحية.
      const assignment = await manager.findOne(OrderAssignment, {
        where: { orderId, technicianId: profile.id, assignmentStatus: In([AssignmentStatus.SENT, AssignmentStatus.VIEWED]) },
      });
      if (!assignment) {
        throw new ApiException(ErrorCode.ORDR_003, 'العرض ده مبقاش متاح', HttpStatus.CONFLICT);
      }

      const now = new Date();
      assignment.assignmentStatus = AssignmentStatus.ACCEPTED;
      assignment.respondedAt = now;
      await manager.save(assignment);

      // RETURNING عشان نعرف بعد الـtransaction مين العروض المرفوضة تلقائيًا (فني تاني قبل) —
      // docs/08 §17.16: الخاسر لازم ياخد فورًا "العرض مبقاش متاح" + أي دورة تذكير critical_offer
      // شغالة ليه لازم توقف. manager.update() العادي مابيرجّعش الصفوف المتأثرة.
      const supersededResult = await manager
        .createQueryBuilder()
        .update(OrderAssignment)
        .set({ assignmentStatus: AssignmentStatus.CANCELLED, respondedAt: now })
        .where('order_id = :orderId AND id != :acceptedId AND assignment_status IN (:...statuses)', {
          orderId,
          acceptedId: assignment.id,
          statuses: [AssignmentStatus.SENT, AssignmentStatus.VIEWED],
        })
        .returning(['id', 'technician_id'])
        .execute();
      const supersededAssignments = supersededResult.raw as { id: string; technician_id: string }[];

      if (!canTransition(order.orderStatus, OrderStatus.TECHNICIAN_ASSIGNED)) {
        throw new ApiException(ErrorCode.ORDR_003, 'انتقال حالة غير مسموح', HttpStatus.CONFLICT);
      }
      order.technicianId = profile.id;
      // مساحة عمل الشركة (ADR-0033) — profile هنا اتحمّل بالفعل (findByUserIdOrThrow فوق)، صفر
      // داعي لاستعلام إضافي زي resolveAssignedCompanyId() تحت.
      order.assignedCompanyId = profile.companyId;
      order.orderStatus = OrderStatus.TECHNICIAN_ASSIGNED;
      order.assignedAt = now;
      await manager.save(order);
      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus: OrderStatus.SEARCHING_TECHNICIAN,
          newStatus: OrderStatus.TECHNICIAN_ASSIGNED,
          changedByUserId: userId,
          changedByRole: 'technician',
          changeSource: OrderChangeSource.TECHNICIAN,
        }),
      );

      order.orderStatus = OrderStatus.ACCEPTED;
      order.acceptedAt = now;
      await manager.save(order);
      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus: OrderStatus.TECHNICIAN_ASSIGNED,
          newStatus: OrderStatus.ACCEPTED,
          changedByUserId: userId,
          changedByRole: 'technician',
          changeSource: OrderChangeSource.TECHNICIAN,
        }),
      );

      return { order, assignmentId: assignment.id, supersededAssignments };
    });

    // بره الـ transaction عمداً — زي order.created، مفيش داعي حد يسمع بيانات مش مؤكّدة
    this.events.emit(
      ORDER_ACCEPTED_EVENT,
      new OrderAcceptedEvent(order.order.id, order.order.customerId, profile.id, order.order.scheduledAt),
    );
    this.events.emit(
      ORDER_OFFER_RESOLVED_EVENT,
      new OrderOfferResolvedEvent(order.assignmentId, order.order.id, order.order.orderNumber, profile.id, 'accepted'),
    );
    for (const superseded of order.supersededAssignments) {
      this.events.emit(
        ORDER_OFFER_RESOLVED_EVENT,
        new OrderOfferResolvedEvent(
          superseded.id,
          order.order.id,
          order.order.orderNumber,
          superseded.technician_id,
          'cancelled_offer_taken',
        ),
      );
    }

    return order.order;
  }

  async reject(userId: string, orderId: string, reasonCode: string | undefined): Promise<void> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);

    const assignment = await this.assignments.findOne({
      where: { orderId, technicianId: profile.id, assignmentStatus: In([AssignmentStatus.SENT, AssignmentStatus.VIEWED]) },
    });
    if (!assignment) {
      throw new ApiException(ErrorCode.VAL_001, 'العرض ده مش موجود ليك', HttpStatus.NOT_FOUND);
    }

    assignment.assignmentStatus = AssignmentStatus.REJECTED;
    assignment.respondedAt = new Date();
    assignment.rejectionReasonCode = reasonCode ?? null;
    await this.assignments.save(assignment);

    const order = await this.orders.findOne({ where: { id: orderId } });
    if (order) {
      this.events.emit(
        ORDER_OFFER_RESOLVED_EVENT,
        new OrderOfferResolvedEvent(assignment.id, orderId, order.orderNumber, profile.id, 'rejected'),
      );
    }

    const remaining = await this.assignments.count({
      where: { orderId, assignmentStatus: In([AssignmentStatus.SENT, AssignmentStatus.VIEWED]) },
    });
    if (remaining === 0) {
      await this.dispatchNextRound(orderId);
    }
  }
}
