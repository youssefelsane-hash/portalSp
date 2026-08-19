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
import { BookingMode, Order, OrderStatus } from '../orders/entities/order.entity';
import { OrderChangeSource, OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES, canTransition } from '../orders/order-state-machine';
import { SettingsService } from '../settings/settings.service';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { technicianAvailabilityCondition } from '../technicians/technician-eligibility.sql';
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

interface EligibleTechnicianRow {
  technician_id: string;
  distance_km: string;
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
  private async findEligibleTechnicians(
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
    return this.dataSource.query<EligibleTechnicianRow[]>(
      `
      SELECT tp.id AS technician_id,
             ST_Distance(tp.current_location, a.location) / 1000.0 AS distance_km
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
        ${technicianAvailabilityCondition({
          technicianIdExpr: 'tp.id',
          scheduledAtParam: '$10',
          excludeOrderIdParam: '$4',
          activeStatusesParam: '$6',
          engagedStatusesParam: '$11',
          isEmergencyParam: '$12',
          serviceDurationExpr: 'COALESCE(s.estimated_duration_minutes, 60)',
          fullDayThresholdMinutesParam: '$13',
          ignoreActiveOrderConflict,
        })}
      ORDER BY (COALESCE(tlc.order_priority_weight, 0) - COALESCE(workload.active_count, 0) * $14::int) DESC,
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
      ],
    );
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
  async autoConfirmScheduledOrder(orderId: string): Promise<{ dispatched: number }> {
    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();
      if (!order || order.orderStatus !== OrderStatus.SEARCHING_TECHNICIAN || !order.serviceZoneId) {
        return { kind: 'noop' as const };
      }

      let candidates = order.requestedTechnicianId
        ? await this.findEligibleTechnicians(order, 1, order.requestedTechnicianId, false)
        : [];
      if (candidates.length === 0 && order.requestedTechnicianCompanyId) {
        candidates = await this.findEligibleTechnicians(order, 1, null, false, order.requestedTechnicianCompanyId);
      }
      if (candidates.length === 0) {
        candidates = await this.findEligibleTechnicians(order, 1, null, false);
      }
      if (candidates.length === 0) {
        return { kind: 'stalled' as const, order };
      }

      const technicianId = candidates[0].technician_id;
      // دفاع عمق ضد سباق نادر (ADR-0017 بند 5 — نفس نمط accept() الموجود بالحرف): قفل صف الفني
      // نفسه وإعادة فحص الأهلية تحت القفل مباشرة قبل الكتابة، عشان لو transaction تانية (accept()
      // أو autoConfirmScheduledOrder لطلب تاني) أكّدت نفس الفني لموعد متعارض في نفس اللحظة تقريبًا،
      // النداء ده يخسر السباق بأمان (stalled، مش استثناء غير متوقع/خطأ DB خام) بدل ما يكتب فوق
      // حالة اتغيّرت. uq_orders_one_active_asap_per_technician (migration 0144) لسه بتحمي حالة
      // ASAP بس على مستوى DB — التعارض بين طلبين مجدولين بيتفحص هنا بس دلوقتي (فجوة موثّقة).
      const lockedTechnician = await this.assignmentGuard.lockTechnician(manager, technicianId);
      try {
        await this.assignmentGuard.assertEligible(manager, lockedTechnician, order);
      } catch {
        return { kind: 'stalled' as const, order };
      }

      const now = new Date();
      await manager.save(
        manager.create(OrderAssignment, {
          orderId: order.id,
          technicianId,
          assignmentRound: 1,
          distanceKm: candidates[0].distance_km,
          assignmentStatus: AssignmentStatus.ACCEPTED,
          sentAt: now,
          respondedAt: now,
          expiresAt: now,
        }),
      );

      if (!canTransition(order.orderStatus, OrderStatus.TECHNICIAN_ASSIGNED)) {
        return { kind: 'noop' as const };
      }
      order.technicianId = technicianId;
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

      return { kind: 'confirmed' as const, order, technicianId };
    });

    if (result.kind === 'noop') {
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
