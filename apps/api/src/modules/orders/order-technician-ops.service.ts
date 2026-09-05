import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ORDER_REMATCH_REQUESTED_EVENT, OrderRematchRequestedEvent } from '../../common/events/order-rematch-requested.event';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { TECHNICIAN_ORDER_CANCELLED_EVENT, TechnicianOrderCancelledEvent } from '../../common/events/technician-order-cancelled.event';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditLogService } from '../audit/audit-log.service';
import { CancellationReasonsService } from './cancellation-reasons.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from '../payments/entities/wallet.entity';
import { WalletTxType } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { SettingsService } from '../settings/settings.service';
import { CrewShortageEscalationService } from './crew-shortage-escalation.service';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { insertDurableInAppNotification } from './durable-in-app-notification';
import { OrderMedia, OrderMediaType } from './entities/order-media.entity';
import { CancelOrderAsTechnicianDto } from './dto/cancel-order-as-technician.dto';
import { ContinueWorkAnotherDayDto } from './dto/continue-work-another-day.dto';
import { RequestRematchDto } from './dto/request-rematch.dto';
import { TechnicianCancellationPolicyResponseDto } from './dto/technician-cancellation-policy-response.dto';
import { CancellationAppliesTo } from './entities/cancellation-reason.entity';
import { CancellationRecoveryAction, TechnicianOrderCancellation } from './entities/technician-order-cancellation.entity';
import { BookingMode, Order, OrderStatus } from './entities/order.entity';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';
import { PreviewOrderResponseDto } from './dto/preview-order-response.dto';
import { BookingMatchPreview } from './entities/booking-match-preview.entity';
import { LOCKED_PROVIDER_UNAVAILABLE_AT_CONFIRM_AR, orderPriceIsProviderBound } from './order-provider-lock';
import { OrderQueriesService } from './order-queries.service';
import { crewShortageMessageAr, orderRequiresCrewBeyondLeader, OrderTeamService } from './order-team.service';
import { canTransition } from './order-state-machine';

// نافذة إلغاء الفني بلا عقوبة (docs/10) — والحد الأدنى قبل الموعد المجدول.
const TECHNICIAN_CANCEL_WINDOW_MINUTES_FALLBACK = 10;
const TECHNICIAN_CANCEL_MIN_MINUTES_BEFORE_SCHEDULED_FALLBACK = 60;

// الحالات اللي الفني يقدر يلغي فيها نفسه — بعد ما الشغل الفعلي يبدأ (in_progress فما بعده)
// الإلغاء لازم يعدّي من الشكوى مش زرار مباشر (نفس الحد القديم، لسه موجود).
const TECHNICIAN_CANCELLABLE_STATUSES = new Set<OrderStatus>([
  OrderStatus.ACCEPTED,
  OrderStatus.TECHNICIAN_ON_WAY,
  OrderStatus.TECHNICIAN_ARRIVED,
]);

/**
 * **عمليات الفني على الطلب — الشريحة ٤ من تقسيم `OrdersService`** (تدقيق A-1).
 *
 * كل حاجة الفني بيعملها **على طلب هو ماسكه بالفعل**، من أول ما يبقى معيّن لحد ما يخلّص أو
 * يسيب:
 *
 * | | إيه |
 * |---|---|
 * | دورة التنفيذ | `depart` → `arrive` → `start` → `complete` |
 * | تمديد | `continueWorkAnotherDay` — الشغل مخلصش النهاردة |
 * | خروج | `technicianCancel` + سياسة نافذة الإلغاء |
 * | استبدال | `requestRematch` — الفني بيطلب حد تاني ياخدها |
 *
 * كلهم بيعدّوا على `transitionAsTechnician()` — مصدر واحد بيحترم الـstate machine ويسجّل
 * التاريخ، فمفيش انتقال بيتكتب بإيد في نقطة منهم.
 *
 * الاعتماديتان `@Optional()` (تصعيد نقص الطاقم، وحارس التعيين) اتنقلوا بنفس صفتهم بالحرف —
 * غيابهم بيقلّل السلوك مش بيكسره، وده كان قرارًا موثّقًا قبل التقسيم.
 */
@Injectable()
export class OrderTechnicianOpsService {
  private readonly logger = new Logger(OrderTechnicianOpsService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderMedia) private readonly orderMedia: Repository<OrderMedia>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly queries: OrderQueriesService,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
    private readonly cancellationReasonsService: CancellationReasonsService,
    private readonly walletsService: WalletsService,
    private readonly settingsService: SettingsService,
    private readonly orderTeamService: OrderTeamService,
    private readonly auditLog: AuditLogService,
    private readonly events: EventEmitter2,
    @Optional() private readonly crewShortageEscalation?: CrewShortageEscalationService,
    @Optional() private readonly assignmentGuard?: TechnicianAssignmentGuardService,
  ) {}

  /**
   * سياسة إلغاء الفني (docs/10-integration-completion-tracker.md) — بيحسب هل النافذة الزمنية
   * المسموحة (بعد القبول + قبل موعد مجدول لو موجود) لسه مفتوحة. مُستخدمة من مكانين: الفحص
   * الاستشاري قبل ما نعرض الزرار (getTechnicianCancellationPolicy) والفرض الفعلي (technicianCancel) —
   * نفس المصدر بالظبط عشان الواجهة والباك-إند ميختلفوش أبداً.
   */
  private async evaluateCancellationWindow(
    order: Order,
  ): Promise<{ withinWindow: boolean; windowExpiresAt: Date | null; blockedReason: string | null }> {
    if (!order.acceptedAt) {
      return { withinWindow: false, windowExpiresAt: null, blockedReason: 'الطلب لسه ما اتقبلش' };
    }
    const windowMinutes = await this.settingsService.getNumber(
      'cancellation.window_minutes_after_acceptance',
      TECHNICIAN_CANCEL_WINDOW_MINUTES_FALLBACK,
    );
    const windowExpiresAt = new Date(order.acceptedAt.getTime() + windowMinutes * 60_000);
    const now = new Date();
    if (now > windowExpiresAt) {
      return {
        withinWindow: false,
        windowExpiresAt,
        blockedReason: `عدّت المدة المسموحة للإلغاء الذاتي (${windowMinutes} دقيقة بعد القبول) — تواصل مع الدعم لإلغاء إداري`,
      };
    }
    if (order.scheduledAt) {
      const minMinutesBefore = await this.settingsService.getNumber(
        'cancellation.min_minutes_before_scheduled_start',
        TECHNICIAN_CANCEL_MIN_MINUTES_BEFORE_SCHEDULED_FALLBACK,
      );
      const cutoff = new Date(order.scheduledAt.getTime() - minMinutesBefore * 60_000);
      if (now > cutoff) {
        return {
          withinWindow: false,
          windowExpiresAt,
          blockedReason: `اقتربنا من موعد الطلب المجدول (أقل من ${minMinutesBefore} دقيقة) — الإلغاء الذاتي متوقف، تواصل مع الدعم`,
        };
      }
    }
    return { withinWindow: true, windowExpiresAt, blockedReason: null };
  }

  /**
   * ADR-0017 بند 9 (ADR-0018: autoConfirmScheduledOrder) — هل الطلب ده وصل لـACCEPTED عبر
   * autoConfirmScheduledOrder (matching.service.ts)
   * مش عبر قبول فني فعلي؟ بنستنتجها من `order_status_history` (`change_source='system'` +
   * `new_status='accepted'`) — نفس فلسفة ADR-0006 §3 بالحرف: استنتاج من إشارة موجودة بالفعل
   * بدل عمود جديد. `LIMIT 1` كافية — الطلب ميقدرش يوصل لـaccepted من system غير مرة واحدة
   * (انتقالات الحالة بعدها تاخده لحالات تانية، ولو رجع searching_technician واتأكد تاني هيتسجل
   * صف تاني بنفس الإشارة برضه — النتيجة صحيحة في الحالتين).
   */
  private async wasAutoConfirmedBySystem(orderId: string): Promise<boolean> {
    const [row] = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM order_status_history
       WHERE order_id = $1 AND new_status = 'accepted' AND change_source = 'system'
       LIMIT 1`,
      [orderId],
    );
    return !!row;
  }

  /** بيستخدمه apps/technician-app قبل ما يعرض زرار "إلغاء" — استشاري بس، الفرض الحقيقي جوّه technicianCancel(). */
  async getTechnicianCancellationPolicy(userId: string, orderId: string): Promise<TechnicianCancellationPolicyResponseDto> {
    const order = await this.queries.findOwnedByTechnicianOrThrow(userId, orderId);

    if (!TECHNICIAN_CANCELLABLE_STATUSES.has(order.orderStatus)) {
      return { can_cancel: false, reason_if_not: 'الطلب في حالة مينفعش تلغيه فيها', window_expires_at: null };
    }

    const selfCancelEnabled = await this.settingsService.getBoolean('cancellation.technician_self_cancel_enabled', true);
    if (!selfCancelEnabled) {
      return { can_cancel: false, reason_if_not: 'إلغاء الفني الذاتي متوقف حاليًا — تواصل مع الدعم', window_expires_at: null };
    }

    // ADR-0017 بند 9 — نفس الفحص في technicianCancel() (المصدر الحقيقي)، هنا استشاري بس عشان
    // apps/technician-app يقدر يعرض "شغلانة مؤكدة" بدل زرار إلغاء عادي من الأساس.
    if (await this.wasAutoConfirmedBySystem(orderId)) {
      return {
        can_cancel: false,
        reason_if_not: 'الطلب ده اتأكّد تلقائيًا بموعد مستقبلي — تواصل مع الدعم/الأدمن لإلغائه',
        window_expires_at: null,
      };
    }

    const { withinWindow, windowExpiresAt, blockedReason } = await this.evaluateCancellationWindow(order);
    return {
      can_cancel: withinWindow,
      reason_if_not: withinWindow ? null : blockedReason,
      window_expires_at: windowExpiresAt?.toISOString() ?? null,
    };
  }

  /**
   * الفني بيلغي طلب اتقبله بنفسه — سياسة كاملة قابلة للإعداد (docs/10-integration-completion-tracker.md
   * "سياسة إلغاء الفني")، مش القرار القديم (رسوم بس + إلغاء نهائي دايمًا). **قرار جوهري جديد**:
   * الطلب **مابيتلغيش نهائي** — بيرجع للمطابقة التلقائية (`SEARCHING_TECHNICIAN`، استبعاد الفني
   * اللي لغى تلقائيًا لأن `order_assignments` بتاعته لسه موجودة لنفس الطلب) لو مكانش العميل
   * اختار الفني ده بنفسه، أو محتاج العميل يختار بديل بنفسه (`AWAITING_TECHNICIAN_RESELECTION`)
   * لو كان اختيار صريح من العميل (`requested_technician_id`) أو auto-rematch متعطّل من الإعدادات.
   * `CANCELLED_BY_TECHNICIAN` (الحالة النهائية القديمة) بقت غير قابلة للوصول من هنا — لسه موجودة
   * في الـstate machine لأسباب توافقية بس (بيانات تاريخية قديمة قبل الميزة دي).
   */
  /**
   * استكمال الشغل يوم تاني (ADR-0047، docs/08 §77-D1).
   *
   * **طلب مالك بنصّه**: «الصنايعي راح شغلانة وكان عامل حسابه يقعد فيها ست ساعات، اكتشف إن فيه
   * قطعة غيار محتاجها ونادرة… يكون فيه خيار استكمال الشغل يوم آخر، ويكون ليه الحرية إن هو
   * يجدوله ليوم تاني، واليوم ده يظهر في الطلبات اللي برا إن الشغل ده مجدول».
   *
   * **مش إعادة جدولة**: `order_reschedule_requests` بتنقل زيارة **لسه ما حصلتش** بموافقة
   * العميل. هنا الشغل بدأ فعلاً، والفني مش بيطلب — هو بيبلّغ. العميل بيتخطر بالسبب والتاريخ.
   *
   * **حالة الطلب بتفضل `in_progress`** والفني مربوط بيه — الشغل شغّال، مجرد إنه متقسّم على
   * أيام. الـADR بيوضّح ليه إضافة حالة جديدة اترفضت.
   */
  async continueWorkAnotherDay(
    userId: string,
    orderId: string,
    dto: ContinueWorkAnotherDayDto,
  ): Promise<{ order: Order; sessionsUsed: number; maxSessions: number }> {
    const technician = await this.techniciansService.findByUserIdOrThrow(userId);
    const configuredMax = await this.settingsService.getNumber('orders.max_work_sessions_per_order', 3);
    const maxSessions = Math.max(1, Math.min(10, Math.floor(configuredMax)));

    // اليوم الجديد لازم يكون بعد النهارده — تجديل لنفس اليوم أو يوم فات مالوش معنى.
    const nextDay = new Date(`${dto.next_session_date}T00:00:00Z`);
    if (Number.isNaN(nextDay.getTime())) {
      throw new ApiException(ErrorCode.VAL_001, 'تاريخ غير صالح', HttpStatus.BAD_REQUEST);
    }
    // اليوم بتوقيت القاهرة — منطقة العمل الوحيدة للمشروع. `toLocaleDateString('en-CA')`
    // بيدّي `YYYY-MM-DD` مباشرة، وهو نفس شكل عمود `DATE` في الجدول.
    const todayCairo = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    if (dto.next_session_date <= todayCairo) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'اختار يوم بعد النهارده — الاستكمال معناه إنك هترجع في يوم تاني',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId AND o.technician_id = :technicianId', { orderId, technicianId: technician.id })
        .getOne();
      if (!order) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
      }
      // بس أثناء التنفيذ الفعلي — قبل ما يبدأ ده «إعادة جدولة» مش «استكمال»، وبعد ما يخلص
      // الطلب اتقفل أصلاً.
      if (order.orderStatus !== OrderStatus.IN_PROGRESS) {
        throw new ApiException(
          ErrorCode.ORDR_003,
          'الاستكمال متاح بس والشغل شغّال — ابدأ الشغل الأول',
          HttpStatus.CONFLICT,
        );
      }

      // القفل فوق (`pessimistic_write` على الطلب) هو اللي بيمنع سباق العدّ ده: نداءين
      // متزامنين مش هيقدروا يعدّوا نفس الرقم ويعدّوا الحد الأقصى مع بعض.
      const [{ count }] = await manager.query<{ count: string }[]>(
        `SELECT COUNT(*)::int AS count FROM order_work_sessions WHERE order_id = $1`,
        [orderId],
      );
      const sessionsUsed = Number(count);
      if (sessionsUsed >= maxSessions) {
        throw new ApiException(
          ErrorCode.ORDR_006,
          `وصلت للحد الأقصى (${maxSessions}) لتأجيل الشغل في الطلب ده — كلّم الدعم`,
          HttpStatus.CONFLICT,
        );
      }

      // الزيارة اللي وقفت النهارده + الزيارة الجاية. الفهرس الفريد الجزئي
      // (`uq_order_work_sessions_one_scheduled`) بيضمن إن مفيش أكتر من زيارة مجدولة مفتوحة.
      await manager.query(
        `INSERT INTO order_work_sessions (order_id, technician_id, session_date, status, pause_reason)
         VALUES ($1, $2, $3, 'completed_partial', $4)`,
        [orderId, technician.id, todayCairo, dto.pause_reason.trim()],
      );
      await manager.query(
        `INSERT INTO order_work_sessions (order_id, technician_id, session_date, status)
         VALUES ($1, $2, $3, 'scheduled')`,
        [orderId, technician.id, dto.next_session_date],
      );

      // `scheduled_at` بيتحدّث لليوم الجديد — وده **بيحقق تلات حاجات مع بعض**، مش واحدة:
      //  1. الطلب يبان «مجدول» في القوايم برّه زي ما المالك طلب.
      //  2. تقارير «متأخر» (اللي بتقارن بـ`scheduled_at`) تبطل تعتبره متأخر ظلمًا.
      //  3. **حجز طاقة الفني في اليوم الجديد يشتغل لوحده** (ADR-0047، القرار الفرعي 2):
      //     منطق تعارض الأهلية (`technician-eligibility.sql.ts`) بيقارن أيام الطلبات النشطة
      //     بـ`scheduled_at`، و`in_progress` موجودة في `ACTIVE_TECHNICIAN_ORDER_STATUSES`
      //     و`ENGAGED_TECHNICIAN_ORDER_STATUSES` الاتنين. يعني بمجرد تحديث اليوم، الفني بقى
      //     محجوز فيه بالآلية القائمة — **من غير أي منطق موازي**، وده مقصود مش صدفة: أي فحص
      //     تاني كان هيبقى مصدر حقيقة تاني لازم يفضل متزامن مع الأول للأبد.
      const previousScheduledAt = order.scheduledAt;
      await manager.update(Order, { id: orderId }, { scheduledAt: nextDay });
      order.scheduledAt = nextDay;

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId,
          previousStatus: order.orderStatus,
          newStatus: order.orderStatus,
          changedByUserId: userId,
          changedByRole: 'technician',
          changeSource: OrderChangeSource.TECHNICIAN,
          reason:
            `استكمال الشغل يوم تاني — من ${previousScheduledAt?.toISOString() ?? 'بلا موعد'} ` +
            `لـ ${nextDay.toISOString()}. السبب: ${dto.pause_reason.trim()}`,
        }),
      );

      // العميل بيتخطر بالسبب الحقيقي حرفيًا — مش رسالة عامة. ADR-0047 (القرار الفرعي 3):
      // الشفافية هي الحل، مش طلب موافقة على حاجة العميل مش شايفها أصلاً.
      const customer = await this.customerProfiles.findByProfileIdOrThrow(order.customerId);
      if (customer) {
        await insertDurableInAppNotification(manager, {
          userId: customer.userId,
          notificationType: 'order_rescheduled',
          titleAr: 'الفني هيكمّل شغل طلبك يوم تاني',
          bodyAr:
            `طلب رقم ${order.orderNumber}: الفني وقف الشغل مؤقتًا — ${dto.pause_reason.trim()}. ` +
            `هيرجع يكمّل يوم ${dto.next_session_date}.`,
          orderId,
          deepLink: `/orders/${orderId}`,
        });
      }

      return { order, sessionsUsed: sessionsUsed + 2, maxSessions };
    });
  }

  async technicianCancel(userId: string, orderId: string, dto: CancelOrderAsTechnicianDto): Promise<Order> {
    const order = await this.queries.findOwnedByTechnicianOrThrow(userId, orderId);

    if (!TECHNICIAN_CANCELLABLE_STATUSES.has(order.orderStatus)) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        `مينفعش تلغي الطلب وهو في حالة ${order.orderStatus} — بعد ما تبدأ الشغل الإلغاء لازم يعدّي من الشكوى`,
        HttpStatus.CONFLICT,
      );
    }

    const selfCancelEnabled = await this.settingsService.getBoolean('cancellation.technician_self_cancel_enabled', true);
    if (!selfCancelEnabled) {
      throw new ApiException(ErrorCode.VAL_001, 'إلغاء الفني الذاتي متوقف حاليًا — تواصل مع الدعم', HttpStatus.FORBIDDEN);
    }

    // ADR-0018 §12 — طلب مجدول اتأكد تلقائيًا (autoConfirmScheduledOrder، بلا قبول فعلي من
    // الفني) ميقدرش يتلغى ذاتيًا زي طلب عادي — حجز عميل مؤكد ميختفيش لمجرد إن الفني ضغط إلغاء.
    // نفس مبدأ ADR-0006 §3 بالحرف (استنتاج من order_status_history بدل عمود جديد) — بس هنا
    // بيستبعد الإلغاء الذاتي تمامًا (مش بس يغيّر سلوك الاسترجاع بعده)، لازم يعدّي بطلب دعم/أدمن.
    if (await this.wasAutoConfirmedBySystem(orderId)) {
      throw new ApiException(
        ErrorCode.ORDR_004,
        'الطلب ده اتأكّد تلقائيًا بموعد مستقبلي — الإلغاء الذاتي مش متاح، تواصل مع الدعم/الأدمن لإلغائه أو إعادة تعيين فني بديل',
        HttpStatus.FORBIDDEN,
      );
    }

    // النافذة الزمنية — لو الفني برّه النافذة، الإلغاء المباشر ممنوع بغض النظر عن الواجهة
    // (الباك-إند بيفرضها حتى لو التطبيق فشل يعرض الزرار صح لأي سبب).
    const { withinWindow, blockedReason } = await this.evaluateCancellationWindow(order);
    if (!withinWindow) {
      throw new ApiException(ErrorCode.ORDR_004, blockedReason ?? 'الإلغاء الذاتي متوقف دلوقتي', HttpStatus.FORBIDDEN);
    }

    // سبب إجباري (docs/10) — كود + نص حر إجباري لو السبب محتاجه صراحة (requires_free_text، زي "أخرى").
    const cancellationReason = await this.cancellationReasonsService.findOrThrow(dto.cancellation_reason_id);
    if (cancellationReason.appliesTo !== CancellationAppliesTo.TECHNICIAN) {
      throw new ApiException(ErrorCode.VAL_001, 'سبب الإلغاء ده مش لإلغاء الفني', HttpStatus.BAD_REQUEST);
    }
    if (cancellationReason.requiresFreeText && !dto.reason?.trim()) {
      throw new ApiException(ErrorCode.VAL_001, 'السبب ده محتاج توضيح نصي', HttpStatus.BAD_REQUEST);
    }
    const feeCents = cancellationReason.chargesFee
      ? Math.round((order.totalAmountCents * Number(cancellationReason.feePercentage)) / 100)
      : 0;

    // سلوك استرجاع الطلب — يختلف حسب booking_mode واختيار العميل الصريح (مش hardcoded،
    // كل قرار هنا مبني على عمود موجود أو إعداد قابل للتعديل):
    // - طوارئ: دايمًا إعادة مطابقة فورية (الطلب "ما يتلغيش" أبدًا، زي ما طلب المالك بالحرف).
    // - العميل اختار الفني ده بنفسه (requestedTechnicianId === technicianId الحالي): مفيش تعيين
    //   صامت لفني تاني — لازم العميل يختار بديل بنفسه.
    // - غير كده (بث عادي): حسب إعداد cancellation.auto_rematch_enabled.
    const customerPickedThisTechnician = order.requestedTechnicianId === order.technicianId;
    let recoveryAction: CancellationRecoveryAction;
    let newStatus: OrderStatus;
    if (order.bookingMode === BookingMode.EMERGENCY) {
      recoveryAction = CancellationRecoveryAction.AUTO_REMATCH;
      newStatus = OrderStatus.SEARCHING_TECHNICIAN;
    } else if (customerPickedThisTechnician) {
      recoveryAction = CancellationRecoveryAction.MANUAL_RESELECTION_REQUIRED;
      newStatus = OrderStatus.AWAITING_TECHNICIAN_RESELECTION;
    } else {
      const autoRematchEnabled = await this.settingsService.getBoolean('cancellation.auto_rematch_enabled', true);
      if (autoRematchEnabled) {
        recoveryAction = CancellationRecoveryAction.AUTO_REMATCH;
        newStatus = OrderStatus.SEARCHING_TECHNICIAN;
      } else {
        recoveryAction = CancellationRecoveryAction.MANUAL_RESELECTION_REQUIRED;
        newStatus = OrderStatus.AWAITING_TECHNICIAN_RESELECTION;
      }
    }

    if (!canTransition(order.orderStatus, newStatus)) {
      throw new ApiException(ErrorCode.ORDR_003, 'انتقال حالة غير مسموح', HttpStatus.CONFLICT);
    }

    const acceptedAt = order.acceptedAt!; // evaluateCancellationWindow اتأكدت فوق إنه موجود
    const elapsedSecondsAfterAcceptance = Math.max(0, Math.round((Date.now() - acceptedAt.getTime()) / 1000));

    const previousStatus = order.orderStatus;
    const cancelledTechnicianId = order.technicianId!;
    await this.dataSource.transaction(async (manager) => {
      // قفل ذرّي على صف الطلب — مفيش إلغاء مزدوج ولا سباق مع accept()/dispatchNextRound() اللي
      // بتاخد نفس القفل (matching.service.ts)، نفس النمط بالظبط.
      const lockedOrder = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();
      if (!lockedOrder || lockedOrder.orderStatus !== previousStatus || lockedOrder.technicianId !== cancelledTechnicianId) {
        throw new ApiException(ErrorCode.ORDR_003, 'الطلب اتغيّرت حالته بالفعل — حاول تاني', HttpStatus.CONFLICT);
      }

      lockedOrder.orderStatus = newStatus;
      lockedOrder.technicianId = null;
      lockedOrder.assignedAt = null;
      // AUTO_REMATCH: نصفّرها عشان dispatchNextRound() ميحاولش يقيّد الجولة الأولى على الفني
      // اللي اتستبعد بالفعل (استعلام إضافي بلا فايدة، مش خطأ، بس تنظيف). MANUAL_RESELECTION_REQUIRED:
      // نسيبها زي ما هي عمداً — القيمة دلوقتي بتشاور على الفني اللي لغى بالذات، وapps/customer-app
      // بيستخدمها (exclude_technician_id) عشان القايمة متعرضهوش تاني في شاشة اختيار البديل.
      if (recoveryAction === CancellationRecoveryAction.AUTO_REMATCH) {
        lockedOrder.requestedTechnicianId = null;
      }
      await manager.save(lockedOrder);

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: lockedOrder.id,
          previousStatus,
          newStatus,
          changedByUserId: userId,
          changedByRole: 'technician',
          changeSource: OrderChangeSource.TECHNICIAN,
          reason: dto.reason ?? cancellationReason.reasonAr,
        }),
      );

      await manager.save(
        manager.create(TechnicianOrderCancellation, {
          orderId: lockedOrder.id,
          technicianId: cancelledTechnicianId,
          technicianUserId: userId,
          cancellationReasonId: cancellationReason.id,
          reasonText: dto.reason ?? null,
          bookingMode: lockedOrder.bookingMode,
          acceptedAt,
          cancelledAt: new Date(),
          elapsedSecondsAfterAcceptance,
          withinPolicyWindow: true,
          recoveryAction,
          feeCents,
        }),
      );

      if (feeCents > 0) {
        const technicianWallet = await this.walletsService.getOrCreateWallet(
          userId,
          WalletOwnerType.TECHNICIAN,
          manager,
        );
        const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID, manager);
        await this.walletsService.doubleEntry(
          {
            fromWalletId: technicianWallet.id,
            toWalletId: platformWallet.id,
            amountCents: feeCents,
            transactionType: WalletTxType.PENALTY,
            referenceType: 'order',
            referenceId: lockedOrder.id,
            descriptionAr: `رسوم إلغاء طلب ${lockedOrder.orderNumber} بعد القبول`,
            allowNegativeBalance: true,
          },
          manager,
        );
      }

      await this.auditLog.record(
        {
          actorUserId: userId,
          actorRole: 'technician',
          action: 'order.technician_cancelled',
          entityType: 'order',
          entityId: lockedOrder.id,
          newValues: {
            order_number: lockedOrder.orderNumber,
            cancellation_reason_id: cancellationReason.id,
            reason_text: dto.reason ?? null,
            elapsed_seconds_after_acceptance: elapsedSecondsAfterAcceptance,
            within_policy_window: true,
            booking_mode: lockedOrder.bookingMode,
            recovery_action: recoveryAction,
            fee_cents: feeCents,
          },
        },
        manager,
      );

      order.orderStatus = lockedOrder.orderStatus;
      order.technicianId = lockedOrder.technicianId;
      order.assignedAt = lockedOrder.assignedAt;
      order.requestedTechnicianId = lockedOrder.requestedTechnicianId;
    });

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(order.id, order.orderNumber, previousStatus, newStatus, order.customerId, null, dto.reason ?? null),
    );
    this.events.emit(
      TECHNICIAN_ORDER_CANCELLED_EVENT,
      new TechnicianOrderCancelledEvent(
        order.id,
        order.orderNumber,
        order.customerId,
        cancelledTechnicianId,
        dto.reason ?? cancellationReason.reasonAr,
        recoveryAction,
        order.bookingMode,
      ),
    );
    if (recoveryAction === CancellationRecoveryAction.AUTO_REMATCH) {
      this.events.emit(ORDER_REMATCH_REQUESTED_EVENT, new OrderRematchRequestedEvent(order.id));
    }

    return order;
  }

  /**
   * **استهلاك تذكرة معاينة بديلة على طلب قايم** (ADR-0065 §3) — نقطة الكتابة الوحيدة لتحديث
   * منفّذ الطلب وسعره مع بعض.
   *
   * التذكرة بتتقفل هنا (`FOR UPDATE`) وبتتفحص تاني جوّه الترانزاكشن — نفس نمط `create()` بالحرف،
   * عشان نداءين متزامنين مايستهلكوش نفس التذكرة. وبعدها الفني بيتفحص بنفس بوابة المطابقة قبل ما
   * الطلب يرجع للتوزيع، فالبديل نفسه مايبقاش «مختار» وهو أصلاً مرفوض.
   *
   * **السعر بيتحدّث من لقطة التذكرة، مش بيفضل زي ما هو.** المدخلات واحدة (البصمة اتفحصت فوق)،
   * فالفرق الوحيد هو مضاعف مستوى المنفّذ الجديد — والعميل شافه في المعاينة ووافق عليه.
   */
  private async consumeReplacementPreview(
    manager: EntityManager,
    order: Order,
    previewId: string,
  ): Promise<void> {
    const locked = await manager
      .createQueryBuilder(BookingMatchPreview, 'preview')
      .setLock('pessimistic_write')
      .where('preview.id = :id AND preview.customerId = :customerId', { id: previewId, customerId: order.customerId })
      .getOne();
    if (!locked || locked.status !== 'active' || locked.expiresAt.getTime() <= Date.now() || !locked.technicianId) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'معاينة الفني والسعر لم تعد صالحة — اعمل معاينة جديدة',
        HttpStatus.CONFLICT,
      );
    }

    if (this.assignmentGuard) {
      const technician = await manager
        .createQueryBuilder(TechnicianProfile, 'tp')
        .setLock('pessimistic_write')
        .where('tp.id = :id', { id: locked.technicianId })
        .getOne();
      if (!technician) {
        throw new ApiException(ErrorCode.ORDR_001, LOCKED_PROVIDER_UNAVAILABLE_AT_CONFIRM_AR, HttpStatus.CONFLICT);
      }
      try {
        await this.assignmentGuard.assertEligible(manager, technician, order);
      } catch {
        throw new ApiException(ErrorCode.ORDR_001, LOCKED_PROVIDER_UNAVAILABLE_AT_CONFIRM_AR, HttpStatus.CONFLICT);
      }
    }

    const snapshot = locked.pricingSnapshot as unknown as PreviewOrderResponseDto;
    order.requestedTechnicianId = locked.technicianId;
    order.selectedMatchPreviewId = locked.id;
    order.providerLockSource = 'match_preview';
    order.estimatedPriceCents = snapshot.base_price_cents;
    order.inspectionFeeCents = snapshot.inspection_fee_cents;
    order.surgeAmountCents = snapshot.emergency_surcharge_cents;
    order.discountAmountCents = snapshot.discount_cents;
    order.warrantyPriceCents = snapshot.warranty_price_cents;
    order.totalAmountCents = locked.finalPriceCents;
    if (snapshot.duration_minutes !== null) order.durationMinutes = snapshot.duration_minutes;
    if (snapshot.estimated_duration_days !== null) order.estimatedDurationDays = snapshot.estimated_duration_days;
    if (snapshot.required_technicians !== null) order.requiredTechnicians = snapshot.required_technicians;
    if (snapshot.required_assistants !== null) order.requiredAssistants = snapshot.required_assistants;

    locked.status = 'consumed';
    locked.consumedAt = new Date();
    locked.orderId = order.id;
    await manager.save(locked);
  }

  /**
   * العميل بيستخدمها لما طلبه يبقى `awaiting_technician_reselection` (فني لغى طلب كان مختاره
   * بنفسه) — إما يختار فني بديل بعينه (`requested_technician_id`) أو يسيب المطابقة التلقائية
   * تختار. الطلب الأصلي (خدمة/عنوان/موعد) محفوظ بالكامل — مفيش إنشاء طلب جديد.
   */
  async requestRematch(userId: string, orderId: string, dto: RequestRematchDto): Promise<Order> {
    const order = await this.queries.findOneOwnedOrThrow(userId, orderId);
    if (order.orderStatus !== OrderStatus.AWAITING_TECHNICIAN_RESELECTION) {
      throw new ApiException(ErrorCode.ORDR_003, 'الطلب مش في حالة تستني اختيار فني بديل', HttpStatus.CONFLICT);
    }
    if (dto.requested_technician_id) {
      await this.techniciansService.findByProfileIdOrThrow(dto.requested_technician_id);
    }

    // **ADR-0065 §3** — طلب سعره اتحسب على أساس فني بعينه مايرجعش للتوزيع بنفس الفاتورة. الفني
    // البديل ممكن يكون مستوى أغلى، فالرجوع الصامت كان بيبقى زيادة سعر بلا موافقة — نفس اللي
    // القفل اتعمل عشانه من الأساس، بس من الباب التاني.
    const priceBound = orderPriceIsProviderBound(order);
    if (priceBound && !dto.match_preview_id) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'سعر الطلب ده اتحسب على أساس فني بعينه — اعمل معاينة جديدة واختار منها فني وسعره قبل ما نكمّل',
        HttpStatus.BAD_REQUEST,
      );
    }
    let replacementPreview: BookingMatchPreview | null = null;
    if (dto.match_preview_id) {
      replacementPreview = await this.dataSource.getRepository(BookingMatchPreview).findOne({
        where: { id: dto.match_preview_id, customerId: order.customerId },
      });
      if (
        !replacementPreview ||
        replacementPreview.status !== 'active' ||
        replacementPreview.expiresAt.getTime() <= Date.now() ||
        !replacementPreview.technicianId
      ) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'معاينة الفني والسعر انتهت أو استُخدمت — اعمل معاينة جديدة قبل التأكيد',
          HttpStatus.CONFLICT,
        );
      }
      if (
        replacementPreview.serviceId !== order.serviceId ||
        replacementPreview.addressId !== order.addressId ||
        (priceBound && replacementPreview.bookingContextHash !== order.bookingContextHash)
      ) {
        // ADR-0065 §4 — البصمة هي اللي بتمنع «معاينة لشغلانة أرخص» تتستخدم لطلب قايم.
        throw new ApiException(
          ErrorCode.VAL_001,
          'المعاينة دي مش لنفس تفاصيل الطلب — اعمل معاينة جديدة من صفحة الطلب',
          HttpStatus.CONFLICT,
        );
      }
      if (dto.requested_technician_id && dto.requested_technician_id !== replacementPreview.technicianId) {
        throw new ApiException(ErrorCode.VAL_001, 'الفني المرسل مختلف عن الفني المثبّت في المعاينة', HttpStatus.CONFLICT);
      }
    }

    const previousStatus = order.orderStatus;
    await this.dataSource.transaction(async (manager) => {
      const lockedOrder = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();
      if (!lockedOrder || lockedOrder.orderStatus !== OrderStatus.AWAITING_TECHNICIAN_RESELECTION) {
        throw new ApiException(ErrorCode.ORDR_003, 'الطلب مش في حالة تستني اختيار فني بديل', HttpStatus.CONFLICT);
      }
      lockedOrder.orderStatus = OrderStatus.SEARCHING_TECHNICIAN;
      lockedOrder.requestedTechnicianId = dto.requested_technician_id ?? null;
      if (replacementPreview) {
        await this.consumeReplacementPreview(manager, lockedOrder, replacementPreview.id);
      }
      await manager.save(lockedOrder);

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: lockedOrder.id,
          previousStatus,
          newStatus: OrderStatus.SEARCHING_TECHNICIAN,
          changedByUserId: userId,
          changedByRole: 'customer',
          changeSource: OrderChangeSource.CUSTOMER,
        }),
      );

      order.orderStatus = lockedOrder.orderStatus;
      order.requestedTechnicianId = lockedOrder.requestedTechnicianId;
    });

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(order.id, order.orderNumber, previousStatus, OrderStatus.SEARCHING_TECHNICIAN, order.customerId, null),
    );
    this.events.emit(ORDER_REMATCH_REQUESTED_EVENT, new OrderRematchRequestedEvent(order.id));

    return order;
  }

  // كانت فجوة موثّقة في apps/technician-app/README.md: مفيش endpoint يرجّع "الطلب النشط
  // الحالي" للفني من غير ما يعرف الـ id مقدماً — يعني التطبيق مقدرش يسترجع شاشة التنفيذ تلقائياً
  // لما يتفتح تاني بعد ما يتقفل في نص الدورة. null لو مفيش طلب نشط، مش خطأ.
  //
  // بَقّة حقيقية اتلقطت (docs/08 §165، بعد ADR-0017): الاستعلام ده كان `findOne` بلا فلترة على
  // `scheduledAt` — قبل migration 0144 كان الافتراض صحيح (فني واحد بياخد طلب `ACCEPTED` واحد بس
  // في نفس الوقت)، دلوقتي الفني ممكن يكون عنده طلب ASAP في التنفيذ الفعلي ونفس الوقت طلب مجدول
  // مستقبلي `ACCEPTED` (مؤكّد تلقائيًا، لسه مالوش موعد وصل). `findOne` كان ممكن يرجّع الطلب
  // الغلط (المجدول بدل الشغال فعليًا دلوقتي) لو كان الأحدث تحديثًا، فالتطبيق كان هيفتح شاشة تنفيذ
  // لطلب لسه معادوش وقته. الفلتر الجديد بيستبعد أي طلب مجدول لسه معاداش موعده — "نشط للاسترجاع"
  // معناها فعليًا شغال دلوقتي أو ASAP، مش "مؤكّد ومستني يوم مستقبلي".
  /**
   * تضييق تاني (docs/08 §56 بند 4، بلاغ مالك 2026-08-25): "الشغل الحالي" لازم يكون **الشغلانة
   * اللي شغّالة فعلاً** بس. الفلتر القديم (`scheduledAt <= now`) كان بيعتبر أي طلب
   * `accepted` معاده وصل "نشط" — يعني لو الفني عنده شغل النهاردة مقبول وشغل متأخر من إمبارح،
   * `findOne` كان بيرجّع واحد منهم بالعشوائي (`updatedAt DESC`) والتاني **بيختفي من الشاشة
   * تمامًا** (مش في `upcoming` كمان لأنها كانت `MoreThan(now)`). دلوقتي "حالي" = الفني متحرّك
   * فعليًا (`ENGAGED_TECHNICIAN_ORDER_STATUSES`، نفس تعريف "منشغل جسديًا" اللي محرك الأهلية
   * بيستخدمه بالحرف) أو طلب ASAP (بالتعريف دلوقتي حالاً). الباقي بيتوزّع على "قدامك"/"متأخر".
   */
  findActiveOrdersForTechnician(userId: string): Promise<Order[]> {
    return this.queries.findActiveOrdersForTechnician(userId);
  }

  findActiveForTechnician(userId: string): Promise<Order | null> {
    return this.queries.findActiveForTechnician(userId);
  }

  findOrdersInTransitForTechnician(technicianProfileId: string): Promise<Order[]> {
    return this.queries.findOrdersInTransitForTechnician(technicianProfileId);
  }

  isTechnicianAssignedToOrder(technicianProfileId: string, order: Order): Promise<boolean> {
    return this.queries.isTechnicianAssignedToOrder(technicianProfileId, order);
  }

  findOverdueForTechnician(userId: string): Promise<Order[]> {
    return this.queries.findOverdueForTechnician(userId);
  }

  findUpcomingConfirmedForTechnician(userId: string): Promise<Order[]> {
    return this.queries.findUpcomingConfirmedForTechnician(userId);
  }

  /** مصدر واحد لكل انتقالات الفني — بتحترم الـ state machine وبتسجل التاريخ زي أي انتقال تاني. */
  /**
   * "الطلب ده اتفتح" (docs/08 §56 بند 2) — بيتعلّم أول مرة بس (`IS NULL` في الـWHERE، فالنداءات
   * اللي بعدها مابتعملش كتابة أصلاً ولا بتغيّر التوقيت الأصلي). مقصور على الفني المعيّن نفسه —
   * عضو فريق بيفتح طلب قائده ماينفعش يعلّمه "مقروء" نيابة عنه.
   *
   * بيعلّم كمان `order_assignments` المعلّق كـ`viewed`: القيمة دي موجودة في الـenum من زمان
   * وبتتقرا في 6 أماكن، بس **محدش كان بيكتبها أبدًا** — دلوقتي بقى ليها معنى حقيقي. آمن تمامًا:
   * كل المسارات بتعامل SENT وVIEWED بنفس الطريقة بالحرف (عرض حي قابل للقبول).
   *
   * أي فشل هنا مايكسرش قراءة الطلب — التعليم راحة استخدام، مش جزء من صحة العملية.
   */
  async markViewedByTechnician(order: Order, technicianProfileId: string): Promise<void> {
    if (order.technicianId !== technicianProfileId || order.technicianViewedAt !== null) return;
    try {
      await this.orders
        .createQueryBuilder()
        .update(Order)
        .set({ technicianViewedAt: () => 'now()' })
        .where('id = :orderId AND technician_id = :technicianId AND technician_viewed_at IS NULL', {
          orderId: order.id,
          technicianId: technicianProfileId,
        })
        .execute();
      await this.orders.manager.query(
        // `viewed_at` بيتكتب مع الحالة في نفس الجملة — أول مشاهدة بس (`IS NULL`) عشان تفضل
        // «أول مشاهدة» مش «آخر واحدة» (migration 0255).
        `UPDATE order_assignments SET assignment_status = 'viewed', viewed_at = COALESCE(viewed_at, now())
         WHERE order_id = $1 AND technician_id = $2 AND assignment_status = 'sent'`,
        [order.id, technicianProfileId],
      );
    } catch (error) {
      this.logger.warn(`فشل تعليم الطلب ${order.id} كمقروء للفني — الطلب نفسه اترجع عادي: ${String(error)}`);
    }
  }

  private async transitionAsTechnician(
    userId: string,
    orderId: string,
    to: OrderStatus,
    applyTimestamp: (order: Order, now: Date) => void,
  ): Promise<Order> {
    const order = await this.queries.findOwnedByTechnicianOrThrow(userId, orderId);

    if (!canTransition(order.orderStatus, to)) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        `مينفعش تنتقل من ${order.orderStatus} لـ ${to}`,
        HttpStatus.CONFLICT,
      );
    }

    // إثبات إنجاز الشغل (docs/08 §20 بند 12، قرار مالك صريح 2026-08-14) — صورة after_photo واحدة
    // على الأقل إجبارية قبل إنهاء الشغل، مفروضة هنا على الباك-إند (مش بس زرار الواجهة) عشان
    // مينفعش يتلف عن طريق نداء الـendpoint مباشرة. عمداً بسيطة زي ما المالك طلب: عدد واحد بس،
    // مفيش قواعد حسب نوع الخدمة أو توقيع عميل. برّه أي transaction — قراءة بس، الطلب لسه في حالته
    // القديمة لحد ما الفحص يعدّي، فمفيش داعي تشارك قفل الطلب.
    if (to === OrderStatus.WORK_COMPLETED) {
      const afterPhotoCount = await this.orderMedia.count({
        where: { orderId: order.id, mediaType: OrderMediaType.AFTER_PHOTO },
      });
      if (afterPhotoCount === 0) {
        throw new ApiException(
          ErrorCode.ORDR_005,
          'لازم ترفع صورة واحدة على الأقل بعد الشغل قبل ما تقفل الطلب',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // بوابة اكتمال الطاقم (docs/08 §35، ADR-0021 §1/§3) — القائد يقدر يتحرّك/يوصل بطاقم ناقص
    // (ممكن باقي الطاقم يوصل بعده)، بس مايبدأش الشغل الفعلي (IN_PROGRESS) قبل ما الطاقم يكتمل —
    // نفس فلسفة بوابة after_photo فوق: قرار مالك صريح مفروض على الباك-إند مش بس زرار الواجهة.
    // docs/01B — تكامل Booking → Execution: البوابة بتنطبق على طلب الفريق (زي ما كانت) **وكمان**
    // على أي طلب محرك التسعير/الإنتاجية حسبله طاقم أكتر من واحد مهما كان وضع الحجز — عميل
    // اختار فني فرد مايبقاش سبب لتخطي متطلبات الطاقم المحسوبة.
    if (to === OrderStatus.IN_PROGRESS && orderRequiresCrewBeyondLeader(order)) {
      const crew = await this.orderTeamService.getCrewComposition(order.id, order);
      if (!crew.crewComplete) {
        // ADR-0064 §1 — الفني واقف قدام باب مقفول، فده **أدق لحظة** نعرف فيها إن النقص بيعطّل
        // شغل حقيقي دلوقتي، مش بعد 24 ساعة لما المسح الدوري يلاحظ. التصعيد بيحصل هنا فورًا
        // (وبيتقفل على نفسه بـ`crew_shortage_escalated_at`، فمفيش إشعار متكرر لو دَس تاني).
        // قبل كده كان الطلب الفردي المحتاج مساعد **بيتمنع بلا أي تصعيد خالص** — الفني متسكّر
        // والإدارة مش عارفة.
        await this.crewShortageEscalation?.escalateNow(order.id, 'technician_blocked_at_start');
        throw new ApiException(
          ErrorCode.ORDR_005,
          crewShortageMessageAr(crew),
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const previousStatus = order.orderStatus;
    const transitionedOrder = await this.dataSource.transaction(async (manager) => {
      const lockedOrder = await manager
        .createQueryBuilder(Order, 'order')
        .setLock('pessimistic_write')
        .where('order.id = :orderId', { orderId })
        .getOne();
      if (
        !lockedOrder ||
        lockedOrder.technicianId !== order.technicianId ||
        lockedOrder.orderStatus !== previousStatus ||
        !canTransition(lockedOrder.orderStatus, to)
      ) {
        throw new ApiException(ErrorCode.ORDR_003, 'حالة الطلب اتغيّرت بالفعل — حاول تاني', HttpStatus.CONFLICT);
      }
      const now = new Date();
      lockedOrder.orderStatus = to;
      applyTimestamp(lockedOrder, now);
      await manager.save(lockedOrder);

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: lockedOrder.id,
          previousStatus,
          newStatus: to,
          changedByUserId: userId,
          changedByRole: 'technician',
          changeSource: OrderChangeSource.TECHNICIAN,
        }),
      );
      return lockedOrder;
    });

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(
        transitionedOrder.id,
        transitionedOrder.orderNumber,
        previousStatus,
        to,
        transitionedOrder.customerId,
        transitionedOrder.technicianId,
      ),
    );

    return transitionedOrder;
  }

  depart(userId: string, orderId: string): Promise<Order> {
    return this.transitionAsTechnician(userId, orderId, OrderStatus.TECHNICIAN_ON_WAY, (order, now) => {
      order.technicianDepartedAt = now;
    });
  }

  arrive(userId: string, orderId: string): Promise<Order> {
    return this.transitionAsTechnician(userId, orderId, OrderStatus.TECHNICIAN_ARRIVED, (order, now) => {
      order.technicianArrivedAt = now;
    });
  }

  start(userId: string, orderId: string): Promise<Order> {
    return this.transitionAsTechnician(userId, orderId, OrderStatus.IN_PROGRESS, (order, now) => {
      order.workStartedAt = now;
    });
  }

  complete(userId: string, orderId: string): Promise<Order> {
    return this.transitionAsTechnician(userId, orderId, OrderStatus.WORK_COMPLETED, (order, now) => {
      order.workCompletedAt = now;
    });
  }
}
