import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { DataSource, EntityManager, In, Not, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ORDER_ACCEPTED_EVENT, OrderAcceptedEvent } from '../../common/events/order-accepted.event';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { BookingMode, Order, OrderStatus } from '../orders/entities/order.entity';
import { OrderChangeSource, OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, canTransition } from '../orders/order-state-machine';
import { SettingsService } from '../settings/settings.service';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianLevelsService } from '../technicians/technician-levels.service';
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
    private readonly technicianLevelsService: TechnicianLevelsService,
    private readonly settingsService: SettingsService,
    private readonly events: EventEmitter2,
    @InjectQueue(MATCHING_ROUNDS_QUEUE) private readonly roundsQueue: Queue<RoundExpiredJobData>,
  ) {}

  /**
   * أقرب فنيين مؤهلين (خدمة + منطقة + متاح + معتمد) لعنوان الطلب، من غير اللي اتبعتلهم قبل كده
   * على نفس الطلب. الترتيب: أولوية المستوى (technician_level_config.order_priority_weight) الأول،
   * وبعدين المسافة — مش بديل عن المسافة، فني أعلى مستوى بياخد أولوية جوّه نفس دائرة المؤهلين مش
   * إنه يتجاهل المسافة تماماً. المسافة بتتحسب فعلياً بـ PostGIS (ST_Distance على geography) — مش تقريب.
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
   */
  /**
   * `requestedTechnicianId` (اختياري، "إعادة الحجز") — بيقيّد النتيجة لفني واحد بس لو اتبعت،
   * نفس شروط الأهلية العادية بالظبط (خدمة/منطقة/متاح/معتمد/مش مشغول). لو رجعت فاضية، الكولر
   * (`dispatchNextRound`) مسؤول يرجع يسأل من غير القيد ده بدل ما يعتبرها "مفيش فنيين خالص".
   *
   * `ignoreAvailabilityFilter` (docs/06 §1.7 — بث "طوارئ") — لو `true`، بيتجاهل شرط
   * `is_available`/`is_on_duty` تمامًا (المالك: "بيوصل لكل الناس القريبة منه بلا استثناء...
   * طالما فاتح نت والإشعار ممكن يوصله"). باقي شروط الأهلية (معتمد، ليه موقع، مش مشغول بطلب
   * نشط بالفعل، مؤهّل للخدمة/المنطقة) بتفضل زي ما هي — "بلا استثناء" في كلام المالك بيقصد
   * حالة التوافر بس، مش قدرة الفني الفعلية إنه يستلم طلب أصلاً.
   *
   * `preferredCompanyId` (docs/06 §1.5 — "اعتماد" بشركة محدّدة) — بيقيّد النتيجة لفنيي نفس
   * الشركة بس لو اتبعت، نفس فلسفة `requestedTechnicianId` بالحرف (تفضيل بس، مش ضمان — لو
   * الشركة مالهاش حد مؤهّل متاح، `dispatchNextRound` يرجع يسأل من غير القيد).
   */
  private findEligibleTechnicians(
    order: Order,
    batchSize: number,
    requestedTechnicianId?: string | null,
    ignoreAvailabilityFilter = false,
    preferredCompanyId?: string | null,
  ): Promise<EligibleTechnicianRow[]> {
    return this.dataSource.query<EligibleTechnicianRow[]>(
      `
      SELECT tp.id AS technician_id,
             ST_Distance(tp.current_location, a.location) / 1000.0 AS distance_km
      FROM technician_profiles tp
      JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = $1 AND ts.is_active = true
      JOIN technician_zones tz ON tz.technician_id = tp.id AND tz.service_zone_id = $2 AND tz.is_active = true
      JOIN addresses a ON a.id = $3
      LEFT JOIN technician_level_config tlc ON tlc.level = tp.current_level
      WHERE tp.verification_status = 'approved'
        AND ($8::boolean OR (tp.is_available = true AND tp.is_on_duty = true))
        AND tp.current_location IS NOT NULL
        AND tp.deleted_at IS NULL
        AND tp.id NOT IN (SELECT technician_id FROM order_assignments WHERE order_id = $4)
        AND tp.id NOT IN (
          SELECT technician_id FROM orders
          WHERE technician_id IS NOT NULL AND order_status = ANY($6::order_status[])
        )
        AND ($7::uuid IS NULL OR tp.id = $7)
        AND ($9::uuid IS NULL OR tp.company_id = $9)
      ORDER BY COALESCE(tlc.order_priority_weight, 0) DESC, distance_km ASC
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

      const { max } = (await manager
        .createQueryBuilder(OrderAssignment, 'a')
        .select('MAX(a.assignmentRound)', 'max')
        .where('a.orderId = :orderId', { orderId })
        .getRawOne<{ max: number | null }>()) ?? { max: null };
      const nextRound = (max ?? 0) + 1;

      const maxRounds = await this.settingsService.getNumber('matching.max_rounds', MAX_ROUNDS_FALLBACK);
      if (nextRound > maxRounds) {
        await this.cancelForNoTechnicians(order, manager);
        return { kind: 'cancelled' as const, order };
      }

      // هيكل الحجز الجديد (docs/06 §1.7) — "طوارئ" بتستخدم دفعة أكبر (افتراضي 10، "أول عشرة"
      // بالحرف من كلام المالك) وبتتجاهل فلتر التوافر العادي تمامًا (تفاصيل في findEligibleTechnicians).
      const isEmergency = order.bookingMode === BookingMode.EMERGENCY;
      const batchSize = isEmergency
        ? await this.settingsService.getNumber('matching.emergency_batch_size', EMERGENCY_BATCH_SIZE_FALLBACK)
        : await this.settingsService.getNumber('matching.batch_size', BATCH_SIZE_FALLBACK);
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
      // مفيش فنيين متاحين (سواء أول جولة أو بعد ما الكل رفض) = مفيش داعي نستنى — نلغي فوراً
      if (candidates.length === 0) {
        await this.cancelForNoTechnicians(order, manager);
        return { kind: 'cancelled' as const, order };
      }

      const responseTimeoutSeconds = await this.settingsService.getNumber(
        'matching.response_timeout_seconds',
        RESPONSE_TIMEOUT_SECONDS_FALLBACK,
      );
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

      return { kind: 'dispatched' as const, order, nextRound, responseTimeoutSeconds, dispatched: rows.length };
    });

    if (result.kind === 'noop') {
      return { dispatched: 0 };
    }
    if (result.kind === 'cancelled') {
      this.emitCancelledForNoTechnicians(result.order);
      return { dispatched: 0 };
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

  // بَقّة حقيقية اتلقطت واتصلحت وقت بناء order-auto-cancel.service.ts (تفاصيل في orders/README.md):
  // الدالة دي كانت بتلغي الطلب فعلياً بس من غير ما تصدّر order.status_changed خالص — يعني العميل
  // (والفني لو موجود) محدش كان بيوصله أي إشعار "مفيش فني قبل طلبك" رغم إن `OrderStatusNotificationListener`
  // أصلاً بيعالج `CANCELLED_BY_SYSTEM` وكان جاهز يستقبل الحدث ده من زمان.
  // بتاخد manager بره transaction dispatchNextRound اللي ماسكة القفل بالفعل — فتح transaction
  // منفصلة هنا كان هيعمل deadlock حقيقي (الاتنين بيحاولوا يقفلوا نفس صف الطلب).
  private async cancelForNoTechnicians(order: Order, manager: EntityManager): Promise<void> {
    order.orderStatus = OrderStatus.CANCELLED_BY_SYSTEM;
    order.cancelledAt = new Date();
    await manager.save(order);
    await manager.save(
      manager.create(OrderStatusHistory, {
        orderId: order.id,
        previousStatus: OrderStatus.SEARCHING_TECHNICIAN,
        newStatus: OrderStatus.CANCELLED_BY_SYSTEM,
        changeSource: OrderChangeSource.SYSTEM,
        reason: 'ORDR_002: لا يوجد فنيون متاحون حالياً',
      }),
    );
  }

  private emitCancelledForNoTechnicians(order: Order): void {
    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(
        order.id,
        order.orderNumber,
        OrderStatus.SEARCHING_TECHNICIAN,
        OrderStatus.CANCELLED_BY_SYSTEM,
        order.customerId,
        order.technicianId,
        'ORDR_002: لا يوجد فنيون متاحون حالياً',
      ),
    );
  }

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
      WHERE oa.technician_id = $1 AND oa.assignment_status = 'sent' AND oa.expires_at > now()
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
    const levelConfig = await this.technicianLevelsService.getOrThrow(profile.currentLevel);

    const order = await this.dataSource.transaction(async (manager) => {
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
      // حد قرار المستوى (technician_level_config.decision_limit_cents) — طلب أكبر من حد الفني
      // محتاج مستوى أعلى يقبله؛ NULL = بلا حد (المستويات العليا)
      if (levelConfig.decisionLimitCents !== null && order.totalAmountCents > levelConfig.decisionLimitCents) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `قيمة الطلب أعلى من حد القبول المسموح لمستواك (${levelConfig.decisionLimitCents / 100} جنيه) — لازم ترقية مستوى`,
          HttpStatus.FORBIDDEN,
        );
      }

      // دفاع تاني بعد استبعاد findEligibleTechnicians في dispatchNextRound — بيغطي حالات مش
      // مغطّاة هناك (تعيين يدوي من الأدمن، أو سباق فني بيقبل عرضين اتبعتوا قبل ما أي حد يتقفل).
      // بَقّة حقيقية اتلقطت واتصلحت (تفاصيل كاملة في findEligibleTechnicians فوق): فني عنده طلب
      // نشط بالفعل كان يقدر يقبل طلب تاني، وده كان بيكسر افتراض "طلب نشط واحد بس" في
      // order-tracking.gateway.ts و`GET /technician/orders/active`.
      const existingActiveOrder = await manager.findOne(Order, {
        where: { technicianId: profile.id, orderStatus: In(ACTIVE_TECHNICIAN_ORDER_STATUSES) },
      });
      if (existingActiveOrder) {
        throw new ApiException(
          ErrorCode.ORDR_003,
          'عندك طلب نشط بالفعل — لازم تخلّصه الأول قبل ما تقبل طلب جديد',
          HttpStatus.CONFLICT,
        );
      }

      const assignment = await manager.findOne(OrderAssignment, {
        where: { orderId, technicianId: profile.id, assignmentStatus: In([AssignmentStatus.SENT, AssignmentStatus.VIEWED]) },
      });
      if (!assignment || assignment.expiresAt.getTime() < Date.now()) {
        throw new ApiException(ErrorCode.ORDR_003, 'العرض ده مبقاش متاح', HttpStatus.CONFLICT);
      }

      const now = new Date();
      assignment.assignmentStatus = AssignmentStatus.ACCEPTED;
      assignment.respondedAt = now;
      await manager.save(assignment);

      await manager.update(
        OrderAssignment,
        { orderId, id: Not(assignment.id), assignmentStatus: In([AssignmentStatus.SENT, AssignmentStatus.VIEWED]) },
        { assignmentStatus: AssignmentStatus.CANCELLED, respondedAt: now },
      );

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

      return order;
    });

    // بره الـ transaction عمداً — زي order.created، مفيش داعي حد يسمع بيانات مش مؤكّدة
    this.events.emit(ORDER_ACCEPTED_EVENT, new OrderAcceptedEvent(order.id, order.customerId, profile.id));

    return order;
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

    const remaining = await this.assignments.count({
      where: { orderId, assignmentStatus: In([AssignmentStatus.SENT, AssignmentStatus.VIEWED]) },
    });
    if (remaining === 0) {
      await this.dispatchNextRound(orderId);
    }
  }
}
