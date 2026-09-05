import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ORDER_RESCHEDULED_EVENT, OrderRescheduledEvent } from '../../common/events/order-rescheduled.event';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { JwtPayload } from '../auth/types/authenticated-request';
import { PaymentGatewayStatus } from '../payments/entities/payment.entity';
import { PaymentsService } from '../payments/payments.service';
import { SettingsService } from '../settings/settings.service';
import { SupportService } from '../support/support.service';
import { TechnicianScheduleService } from '../technicians/technician-schedule.service';
import { ComplaintCategory } from '../support/entities/complaint.entity';
import { FailedVisitReason, ReportFailedVisitDto } from './dto/report-failed-visit.dto';
import { ReportCashNotReceivedDto } from './dto/report-cash-not-received.dto';
import { CashDisputeOutcome, ResolveCashDisputeDto } from './dto/resolve-cash-dispute.dto';
import { FailedVisitOutcome, ResolveFailedVisitDto } from './dto/resolve-failed-visit.dto';
import { Order, OrderPaymentStatus, OrderStatus } from './entities/order.entity';
import { resolveRescheduledInterval, slotEnd, slotStart } from './order-schedule-interval';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderQueriesService } from './order-queries.service';
import { canTransition } from './order-state-machine';

const FAILED_VISIT_REASON_TO_COMPLAINT_CATEGORY: Record<FailedVisitReason, ComplaintCategory> = {
  [FailedVisitReason.CUSTOMER_NO_SHOW]: ComplaintCategory.NO_SHOW,
  [FailedVisitReason.REQUIRED_WORK_REJECTED]: ComplaintCategory.REQUIRED_WORK_REJECTED,
  [FailedVisitReason.OTHER]: ComplaintCategory.OTHER,
};

// الحالات اللي الفني يقدر يبلّغ منها عن زيارة فاشلة (docs/08 §22 بند 3) — وصل ولسه ما بدأش الشغل
// (no-show كلاسيكي)، أو بدأ فعلاً وعرض شغل ضروري اترفض (required_work_rejected).
const FAILED_VISIT_REPORTABLE_STATUSES = new Set<OrderStatus>([OrderStatus.TECHNICIAN_ARRIVED, OrderStatus.IN_PROGRESS]);

// نفس PAYABLE_ORDER_STATUSES في payments.service.ts بالظبط — الحالات اللي فيها كاش لسه مستحق
// (docs/08 §22 بند 13-14).
const CASH_HANDOVER_PAYABLE_STATUSES = new Set<OrderStatus>([OrderStatus.WORK_COMPLETED, OrderStatus.AWAITING_PAYMENT]);

/**
 * **فلو النزاعات على الطلب — الشريحة ٣ من تقسيم `OrdersService`** (تدقيق A-1).
 *
 * الفلو ده بيغطّي الحالتين اللي بيدخل فيهما الطلب `DISPUTED`، وهما مختلفتان في السبب ومتطابقتان
 * في آلية الحل:
 *
 * | الحالة | مين بيفتحها | الخلاف على إيه |
 * |--------|-------------|-----------------|
 * | زيارة فاشلة | الفني | «رحت وملقتش حد» / «العميل رفض الشغل» |
 * | تسليم كاش | الفني أو العميل | «سلّمت» مقابل «مستلمتش» |
 *
 * الاتنين بيتحلّوا بقرار إداري، والاتنين بيعدّوا على `lockDisputedOrderForUpdate()`.
 *
 * ## القفل ده مش تفصيلة
 *
 * كان فيه **بَقّة `lost update` حقيقية**: الحل كان بيقرا الطلب بـ`findOne()` بلا قفل قبل
 * الـtransaction وبعدين يكتب نفس الـobject القديم جوّاها. أدمنان بيحلّوا نفس النزاع في نفس
 * اللحظة ⇒ التاني بيغلب الأول **بكامل الحالة القديمة**، حتى لو الأول نجح وسوّى الطلب فعلاً.
 * القفل + إعادة فحص `DISPUTED` تحت القفل هو اللي بيمنع ده — فتجميع الفلوين هنا بيخلي القاعدة
 * دي في مكان واحد بدل ما تتكرر.
 *
 * ٩ اعتماديات بدل الـ٢٥ بتاعة `OrdersService`، و`OrdersService` بتفوّض بنفس التوقيعات بالحرف.
 */
@Injectable()
export class OrderDisputeService {
  private readonly logger = new Logger(OrderDisputeService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly queries: OrderQueriesService,
    private readonly scheduleService: TechnicianScheduleService,
    private readonly paymentsService: PaymentsService,
    private readonly supportService: SupportService,
    private readonly settingsService: SettingsService,
    private readonly auditLog: AuditLogService,
    private readonly events: EventEmitter2,
  ) {}

  // قفل تشاؤمي + إعادة تحقق DISPUTED جوّه transaction الكتابة نفسها — يمنع "double admin edit"
  // (docs/08 §22 بند 31-32). بَقّة حقيقية اتلقطت حية: resolveFailedVisit/resolveCashHandoverDispute
  // كانوا بيقروا الطلب بـfindOne() عادي (من غير قفل) قبل الـtransaction وبعدين يكتبوا نفس الـobject
  // القديم جوّها (manager.save(order)) — لو أدمن تاني حل نفس النزاع في نفس اللحظة (مثلاً reschedule
  // وcancel_with_fee على نفس الطلب)، الكتابة اللي بتكمل تانية كانت بتغلب الأولى بكامل الحالة
  // القديمة (lost update)، حتى لو الأول فعلاً نجح وسوّى الطلب. نفس نمط adminConfirmCashReceived/
  // refundOrder() الموجود بالفعل (pessimistic_write جوّه الـtransaction اللي بتكتب فعليًا).
  private async lockDisputedOrderForUpdate(manager: EntityManager, orderId: string, orderNumber: string): Promise<Order> {
    const fresh = await manager
      .createQueryBuilder(Order, 'o')
      .setLock('pessimistic_write')
      .where('o.id = :orderId', { orderId })
      .getOne();
    if (!fresh) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
    }
    if (fresh.orderStatus !== OrderStatus.DISPUTED) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        `الطلب ${orderNumber} اتحل بالفعل من إجراء تاني — رجّع الصفحة وشوف الحالة الحالية`,
        HttpStatus.CONFLICT,
      );
    }
    return fresh;
  }

  /**
   * الفني بيبلّغ إن الزيارة فشلت — العميل مش موجود خالص، أو رفض شغل ضروري لإتمام الطلب صح.
   * "الفني بيوقف، مفيش شغل غير مصرّح، مفيش completed كاذبة" — الطلب بيتحول DISPUTED (نفس حالة
   * النزاع الموجودة بالفعل) وبيوديه لمراجعة أدمن حقيقية عبر resolveFailedVisit تحت، مش قرار نهائي
   * فوري بيصدّق طرف واحد أعمى.
   */
  async reportFailedVisit(user: JwtPayload, orderId: string, dto: ReportFailedVisitDto): Promise<Order> {
    const order = await this.queries.findOwnedByTechnicianOrThrow(user.sub, orderId);

    if (!FAILED_VISIT_REPORTABLE_STATUSES.has(order.orderStatus) || !canTransition(order.orderStatus, OrderStatus.DISPUTED)) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        `مينفعش تبلّغ عن زيارة فاشلة والطلب في حالة ${order.orderStatus}`,
        HttpStatus.CONFLICT,
      );
    }

    const previousStatus = order.orderStatus;
    await this.dataSource.transaction(async (manager) => {
      order.orderStatus = OrderStatus.DISPUTED;
      await manager.save(order);

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: OrderStatus.DISPUTED,
          changedByUserId: user.sub,
          changedByRole: 'technician',
          changeSource: OrderChangeSource.TECHNICIAN,
          reason: dto.description,
        }),
      );
    });

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(
        order.id,
        order.orderNumber,
        previousStatus,
        OrderStatus.DISPUTED,
        order.customerId,
        order.technicianId,
        dto.description,
      ),
    );

    // انتقال الحالة عملية منجزة بالفعل (الطلب فعلاً محتاج يتوقف الآن) — فشل تسجيل الشكوى بيتلقّط
    // ويتسجّل بس مايرجّعش الطلب لحالته القديمة، نفس فلسفة attemptAdditionalWorkCharge (docs/08 §21).
    try {
      await this.supportService.fileComplaint(user, {
        order_id: order.id,
        category: FAILED_VISIT_REASON_TO_COMPLAINT_CATEGORY[dto.reason],
        title: `زيارة فاشلة — طلب ${order.orderNumber}`,
        description: dto.description,
      });
    } catch (err) {
      this.logger.error(
        `فشل تسجيل شكوى الزيارة الفاشلة للطلب ${order.id} — الطلب فعلاً DISPUTED، محتاج مراجعة يدوية`,
        err instanceof Error ? err.stack : err,
      );
    }

    return order;
  }

  /**
   * الأدمن بيحل الزيارة الفاشلة بعد المراجعة (مش تلقائي، مش تصديق طرف واحد أعمى — docs/08 §22 بند 4-5).
   * reschedule: نفس الطلب يرجع نشط (ACCEPTED) بنفس السعر، صفر تحصيل تاني — الفني يعيد المحاولة.
   * cancel_with_fee: رسوم زيارة اختيارية (افتراضي orders.no_show_visit_fee_cents) + استرداد الباقي
   * لو الطلب مدفوع مسبقًا فقط. الطلبات الكاش (المنصة ماسكتش فلوس أصلاً) صفر رسوم دايمًا — المنصة
   * بتمتص تكلفة الفني للـMVP، مفيش فلوس عميل بنتخيلها ولا معاملة دفع وهمية.
   */
  async resolveFailedVisit(
    adminUserId: string,
    orderId: string,
    dto: ResolveFailedVisitDto,
    meta?: AuditActorMeta,
  ): Promise<Order> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
    }
    if (order.orderStatus !== OrderStatus.DISPUTED) {
      throw new ApiException(ErrorCode.ORDR_003, 'الطلب لازم يكون متنازع عليه عشان يتحل كزيارة فاشلة', HttpStatus.CONFLICT);
    }

    if (dto.outcome === FailedVisitOutcome.RESCHEDULE) {
      if (!canTransition(order.orderStatus, OrderStatus.ACCEPTED)) {
        throw new ApiException(ErrorCode.ORDR_003, 'انتقال حالة غير مسموح', HttpStatus.CONFLICT);
      }
      // بَقّة حقيقية اتصلحت (docs/08 §25.2، قرار مالك صريح 2026-08-15): "إعادة الجدولة" كانت
      // بترجّع الطلب لـACCEPTED بس — نفس الموعد القديم بالظبط، صفر اختيار موعد جديد، صفر فحص
      // availability. دلوقتي `new_slot_id` إجباري فعليًا هنا — نفس فحوصات POST /orders/:id/reschedule
      // بالحرف (السلوت لازم يكون لنفس الفني ومتاح فعلاً)، جوّه نفس transaction قفل الـdispute.
      if (!dto.new_slot_id) {
        throw new ApiException(ErrorCode.VAL_001, 'لازم تختار موعد جديد (new_slot_id) لإعادة الجدولة', HttpStatus.BAD_REQUEST);
      }
      const newSlot = await this.scheduleService.findAvailableSlotOrThrow(dto.new_slot_id);
      if (newSlot.technicianId !== order.technicianId) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'السلوت الجديد لازم يكون لنفس الفني المعيّن على الطلب',
          HttpStatus.BAD_REQUEST,
        );
      }
      const previousStatus = order.orderStatus;
      const previousScheduledAt = order.scheduledAt;
      const newScheduledAt = slotStart(newSlot);
      await this.dataSource.transaction(async (manager) => {
        const fresh = await this.lockDisputedOrderForUpdate(manager, orderId, order.orderNumber);
        const interval = resolveRescheduledInterval(fresh, newScheduledAt);
        if (interval.scheduledEndAt && interval.scheduledEndAt > slotEnd(newSlot)) {
          throw new ApiException(
            ErrorCode.VAL_001,
            'السلوت الجديد أقصر من مدة الطلب — اختار سلوت يغطي وقت الشغل كاملًا',
            HttpStatus.CONFLICT,
          );
        }
        const booked = await this.scheduleService.rescheduleSlot(orderId, newSlot.id, manager);
        if (!booked) {
          throw new ApiException(ErrorCode.VAL_001, 'السلوت ده اتحجز من حد تاني لسه، اختار سلوت تاني', HttpStatus.CONFLICT);
        }
        fresh.orderStatus = OrderStatus.ACCEPTED;
        fresh.scheduledAt = newScheduledAt;
        fresh.scheduledEndAt = interval.scheduledEndAt;
        fresh.durationMinutes = interval.durationMinutes;
        fresh.durationHours = interval.durationMinutes != null && interval.durationMinutes % 60 === 0
          ? interval.durationMinutes / 60
          : null;
        await manager.save(fresh);
        await manager.save(
          manager.create(OrderStatusHistory, {
            orderId: order.id,
            previousStatus,
            newStatus: OrderStatus.ACCEPTED,
            changedByUserId: adminUserId,
            changedByRole: 'admin',
            changeSource: OrderChangeSource.ADMIN,
            reason: `${dto.admin_notes} — موعد جديد: ${newScheduledAt.toISOString()}`,
          }),
        );
      });
      await this.auditLog.record({
        actorUserId: adminUserId,
        actorRole: 'admin',
        action: 'order.failed_visit_resolved',
        entityType: 'order',
        entityId: order.id,
        newValues: { outcome: 'reschedule', order_status: OrderStatus.ACCEPTED, new_scheduled_at: newScheduledAt.toISOString() },
        meta,
      });
      this.events.emit(
        ORDER_STATUS_CHANGED_EVENT,
        new OrderStatusChangedEvent(
          order.id,
          order.orderNumber,
          previousStatus,
          OrderStatus.ACCEPTED,
          order.customerId,
          order.technicianId,
          dto.admin_notes,
        ),
      );
      this.events.emit(
        ORDER_RESCHEDULED_EVENT,
        new OrderRescheduledEvent(order.id, order.orderNumber, order.technicianId, order.customerId, previousScheduledAt, newScheduledAt),
      );
      // القفل والكتابة الفعلية حصلوا على fresh (نسخة مقفولة جوّه الـtransaction)، مش order —
      // بنرجّع قراءة طازة من الـDB بدل order القديمة عشان القيمة المرجّعة تطابق الحالة الحقيقية
      // بالظبط (نفس بَقّة "lost update on the return value" اللي docs/08 §22 بند 31-32 لقطها).
      return (await this.orders.findOne({ where: { id: orderId } }))!;
    }

    // cancel_with_fee — الطلبات الكاش (مفيش فلوس اتحصّلت أصلاً) صفر رسوم دايمًا، بغض النظر عن
    // visit_fee_cents اللي الأدمن بعتها — تعليمة صريحة، مش نسيان.
    if (order.paymentStatus !== OrderPaymentStatus.PAID) {
      if (!canTransition(order.orderStatus, OrderStatus.CANCELLED_BY_CUSTOMER)) {
        throw new ApiException(ErrorCode.ORDR_003, 'انتقال حالة غير مسموح', HttpStatus.CONFLICT);
      }
      const previousStatus = order.orderStatus;
      await this.dataSource.transaction(async (manager) => {
        const fresh = await this.lockDisputedOrderForUpdate(manager, orderId, order.orderNumber);
        fresh.orderStatus = OrderStatus.CANCELLED_BY_CUSTOMER;
        fresh.cancelledAt = new Date();
        fresh.cancelledByUserId = adminUserId;
        await manager.save(fresh);
        await manager.save(
          manager.create(OrderStatusHistory, {
            orderId: order.id,
            previousStatus,
            newStatus: OrderStatus.CANCELLED_BY_CUSTOMER,
            changedByUserId: adminUserId,
            changedByRole: 'admin',
            changeSource: OrderChangeSource.ADMIN,
            reason: `${dto.admin_notes} — طلب كاش، صفر رسوم (المنصة بتمتص تكلفة الفني)`,
          }),
        );
      });
      await this.auditLog.record({
        actorUserId: adminUserId,
        actorRole: 'admin',
        action: 'order.failed_visit_resolved',
        entityType: 'order',
        entityId: order.id,
        newValues: { outcome: 'cancel_with_fee', payment_method: 'cash', fee_cents: 0, order_status: OrderStatus.CANCELLED_BY_CUSTOMER },
        meta,
      });
      this.events.emit(
        ORDER_STATUS_CHANGED_EVENT,
        new OrderStatusChangedEvent(
          order.id,
          order.orderNumber,
          previousStatus,
          OrderStatus.CANCELLED_BY_CUSTOMER,
          order.customerId,
          order.technicianId,
          dto.admin_notes,
        ),
      );
      // القفل والكتابة الفعلية حصلوا على fresh — بنرجّع قراءة طازة من الـDB بدل order القديمة.
      return (await this.orders.findOne({ where: { id: orderId } }))!;
    }

    // إعادة تحقق تحت قفل حقيقي قبل ما نكمّل — يقفل نفس فجوة "double admin edit" اللي فرعي
    // reschedule/cancel_with_fee (كاش) فوق اتصلحوا بيها، من غير ما نمسك القفل عبر نداء الشبكة
    // الخارجي لـrefundOrder() تحت (نفس قاعدة المشروع: صفر قفل DB ممسوك وقت نداء خارجي).
    await this.dataSource.transaction((manager) => this.lockDisputedOrderForUpdate(manager, orderId, order.orderNumber));

    // مدفوع مسبقًا — رسوم الزيارة بتتخصم من الاسترداد (مش تحصيل إضافي منفصل)، والباقي يترد
    // عبر PaymentsService.refundOrder() الموجودة بالفعل (تدعم استرداد جزئي، وبتنقل الطلب لـREFUNDED
    // تلقائيًا لو الاسترداد كامل — تفاصيل كاملة في تعليق order-state-machine.ts).
    const feeCents = dto.visit_fee_cents ?? (await this.settingsService.getNumber('orders.no_show_visit_fee_cents', 5000));
    const summary = await this.paymentsService.getFinancialSummaryForOrder(orderId);
    const succeededPayments = summary.payments.filter((p) => p.paymentStatus === PaymentGatewayStatus.SUCCEEDED);
    const latestPayment = succeededPayments[succeededPayments.length - 1];
    if (!latestPayment) {
      throw new ApiException(ErrorCode.VAL_001, 'مفيش عملية دفع ناجحة لقى الطلب ده', HttpStatus.CONFLICT);
    }
    const clampedFeeCents = Math.min(feeCents, latestPayment.amountCents);
    const refundAmountCents = latestPayment.amountCents - clampedFeeCents;

    if (refundAmountCents > 0) {
      await this.paymentsService.refundOrder(
        adminUserId,
        orderId,
        `${dto.admin_notes} — رسوم زيارة فاشلة ${clampedFeeCents} قرش مخصومة`,
        refundAmountCents,
        meta,
      );
    }

    // استرداد كامل (فوق) بيحوّل الطلب REFUNDED تلقائيًا جوّه refundOrder() نفسها. استرداد جزئي
    // (فيه رسوم) أو صفر استرداد (الرسوم غطّت كل المبلغ) بيسيبوا الطلب DISPUTED — لازم نقفله يدويًا هنا.
    // الفلوس فعليًا اترجعت للعميل (refundOrder() نجحت فوق) بغض النظر عن نتيجة القفل ده — فلو إجراء
    // تاني (أدمن تاني) قفل النزاع في نفس اللحظة، ده مش سبب نرجّع خطأ للمستخدم بعد ما الفلوس
    // اترجعت فعلاً؛ بس تحذير في اللوج (docs/08 §22 بند 31-32، نفس مبدأ "صفر فشل صامت بس بلا تعليق العملية الحقيقية").
    const reloaded = await this.orders.findOne({ where: { id: orderId } });
    if (reloaded && reloaded.orderStatus === OrderStatus.DISPUTED) {
      const previousStatus = reloaded.orderStatus;
      try {
        await this.dataSource.transaction(async (manager) => {
          const fresh = await this.lockDisputedOrderForUpdate(manager, orderId, reloaded.orderNumber);
          fresh.orderStatus = OrderStatus.CANCELLED_BY_CUSTOMER;
          fresh.cancelledAt = new Date();
          fresh.cancelledByUserId = adminUserId;
          await manager.save(fresh);
          await manager.save(
            manager.create(OrderStatusHistory, {
              orderId: reloaded.id,
              previousStatus,
              newStatus: OrderStatus.CANCELLED_BY_CUSTOMER,
              changedByUserId: adminUserId,
              changedByRole: 'admin',
              changeSource: OrderChangeSource.ADMIN,
              reason: dto.admin_notes,
            }),
          );
        });
      } catch (err) {
        this.logger.warn(
          `resolveFailedVisit: الاسترداد نجح للطلب ${orderId} بس تقفيل الحالة فشل (تعارض مع إجراء تاني على الأرجح) — ${err instanceof Error ? err.message : err}`,
        );
        return (await this.orders.findOne({ where: { id: orderId } }))!;
      }
      this.events.emit(
        ORDER_STATUS_CHANGED_EVENT,
        new OrderStatusChangedEvent(
          reloaded.id,
          reloaded.orderNumber,
          previousStatus,
          OrderStatus.CANCELLED_BY_CUSTOMER,
          reloaded.customerId,
          reloaded.technicianId,
          dto.admin_notes,
        ),
      );
    }

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'order.failed_visit_resolved',
      entityType: 'order',
      entityId: order.id,
      newValues: {
        outcome: 'cancel_with_fee',
        payment_method: 'prepaid',
        fee_cents: clampedFeeCents,
        refund_amount_cents: refundAmountCents,
      },
      meta,
    });

    return (await this.orders.findOne({ where: { id: orderId } }))!;
  }

  // ── تسليم كاش بتأكيد الطرفين (docs/08 §22 بند 13-14) ────────────────────

  /**
   * العميل بيأكّد إنه سلّم الفلوس — تأكيد واحد بس من طرفين، مايسوّيش الطلب لوحده (collectCash()
   * الموجودة هي تأكيد الفني، لسه لازم تتنادى منفصلة). Idempotent — نقر مزدوج/إعادة إرسال بيرجع
   * نجاح من غير أي أثر إضافي (نفس مبدأ حماية النقر المزدوج، docs/08 §22 بند 27).
   */
  async confirmCashHandover(userId: string, orderId: string): Promise<Order> {
    const order = await this.queries.findOneOwnedOrThrow(userId, orderId);

    // بَقّة حقيقية اتلقطت من صاحب المشروع (2026-08-21): الدالة دي ماكانتش بتفحص حالة الطلب
    // خالص — عميل على طلب `pending_payment` (قبل التوزيع، صفر فني معيّن أصلاً بالتصميم، راجع
    // order-state-machine.ts) كان يقدر يدوس "دفعت كاش للفني" ويسجّل تأكيد يتيم (`customerCashConfirmedAt`)
    // من غير أي فني موجود يأكّده أصلاً — الواجهة كانت بترجع "في انتظار تأكيد الفني" لطلب مالوش
    // فني خالص. نفس شرط `reportCashNotReceived()` بالحرف (`CASH_HANDOVER_PAYABLE_STATUSES`) —
    // الحالتين دول (`work_completed`/`awaiting_payment`) الوحيدين اللي فني بيكون معيّن فيهم فعليًا.
    if (!CASH_HANDOVER_PAYABLE_STATUSES.has(order.orderStatus)) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        `مينفعش تأكّد تسليم كاش والطلب في حالة ${order.orderStatus}`,
        HttpStatus.CONFLICT,
      );
    }

    const cashEnabled = await this.settingsService.getBoolean('payments.cash_enabled', true);
    if (!cashEnabled) {
      throw new ApiException(ErrorCode.ORDR_003, 'الدفع كاش معطّل حاليًا', HttpStatus.CONFLICT);
    }

    if (!order.customerCashConfirmedAt) {
      order.customerCashConfirmedAt = new Date();
      await this.orders.save(order);
    }
    return order;
  }

  /**
   * الفني بيبلّغ إنه ما استلمش الكاش — لو العميل كان أكّد التسليم قبل كده، ده نزاع حقيقي (تناقض
   * بين الطرفين)، مش بلاغ عادي. في الحالتين، الطلب بيتحول DISPUTED ويوديه لمراجعة أدمن حقيقية
   * (docs/08 §22 بند 13-14) — أبدًا مايتسوّاش صامت على التناقض.
   */
  async reportCashNotReceived(user: JwtPayload, orderId: string, dto: ReportCashNotReceivedDto): Promise<Order> {
    const order = await this.queries.findOwnedByTechnicianOrThrow(user.sub, orderId);

    if (!CASH_HANDOVER_PAYABLE_STATUSES.has(order.orderStatus) || !canTransition(order.orderStatus, OrderStatus.DISPUTED)) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        `مينفعش تبلّغ عن عدم استلام كاش والطلب في حالة ${order.orderStatus}`,
        HttpStatus.CONFLICT,
      );
    }

    const isConflict = order.customerCashConfirmedAt !== null;
    const previousStatus = order.orderStatus;
    await this.dataSource.transaction(async (manager) => {
      order.technicianCashNotReceivedAt = new Date();
      order.orderStatus = OrderStatus.DISPUTED;
      await manager.save(order);
      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: OrderStatus.DISPUTED,
          changedByUserId: user.sub,
          changedByRole: 'technician',
          changeSource: OrderChangeSource.TECHNICIAN,
          reason: dto.description,
        }),
      );
    });

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(order.id, order.orderNumber, previousStatus, OrderStatus.DISPUTED, order.customerId, order.technicianId, dto.description),
    );

    try {
      await this.supportService.fileComplaint(user, {
        order_id: order.id,
        category: ComplaintCategory.OTHER,
        title: isConflict ? `نزاع تسليم كاش — العميل أكّد والفني قال العكس — طلب ${order.orderNumber}` : `الفني لم يستلم الكاش — طلب ${order.orderNumber}`,
        description: dto.description,
      });
    } catch (err) {
      this.logger.error(
        `فشل تسجيل شكوى نزاع الكاش للطلب ${order.id} — الطلب فعلاً DISPUTED، محتاج مراجعة يدوية`,
        err instanceof Error ? err.stack : err,
      );
    }

    return order;
  }

  /**
   * الأدمن بيحل نزاع تسليم الكاش بعد المراجعة — retry (الفني يعيد المحاولة، صفر تحصيل تلقائي) أو
   * confirm_received (تسوية إدارية مباشرة، الأدمن راجع وقرر إن الكاش فعلاً اتحصّل).
   */
  async resolveCashHandoverDispute(
    adminUserId: string,
    orderId: string,
    dto: ResolveCashDisputeDto,
    meta?: AuditActorMeta,
  ): Promise<Order> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
    }
    if (order.orderStatus !== OrderStatus.DISPUTED || !order.technicianCashNotReceivedAt) {
      throw new ApiException(ErrorCode.ORDR_003, 'الطلب ده مش نزاع تسليم كاش قيد المراجعة', HttpStatus.CONFLICT);
    }

    if (dto.outcome === CashDisputeOutcome.CONFIRM_RECEIVED) {
      await this.paymentsService.adminConfirmCashReceived(adminUserId, orderId, meta);
      return (await this.orders.findOne({ where: { id: orderId } }))!;
    }

    // retry — الطلب يرجع WORK_COMPLETED (زي ما كان قبل النزاع)، collectCash() تشتغل عادي تاني.
    if (!canTransition(order.orderStatus, OrderStatus.WORK_COMPLETED)) {
      throw new ApiException(ErrorCode.ORDR_003, 'انتقال حالة غير مسموح', HttpStatus.CONFLICT);
    }
    const previousStatus = order.orderStatus;
    await this.dataSource.transaction(async (manager) => {
      const fresh = await this.lockDisputedOrderForUpdate(manager, orderId, order.orderNumber);
      if (!fresh.technicianCashNotReceivedAt) {
        throw new ApiException(ErrorCode.ORDR_003, 'الطلب ده مش نزاع تسليم كاش قيد المراجعة', HttpStatus.CONFLICT);
      }
      fresh.orderStatus = OrderStatus.WORK_COMPLETED;
      fresh.customerCashConfirmedAt = null;
      fresh.technicianCashNotReceivedAt = null;
      await manager.save(fresh);
      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: OrderStatus.WORK_COMPLETED,
          changedByUserId: adminUserId,
          changedByRole: 'admin',
          changeSource: OrderChangeSource.ADMIN,
          reason: dto.admin_notes,
        }),
      );
    });
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'order.cash_dispute_resolved_retry',
      entityType: 'order',
      entityId: order.id,
      newValues: { outcome: 'retry', order_status: OrderStatus.WORK_COMPLETED },
      meta,
    });
    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(
        order.id,
        order.orderNumber,
        previousStatus,
        OrderStatus.WORK_COMPLETED,
        order.customerId,
        order.technicianId,
        dto.admin_notes,
      ),
    );
    // القفل والكتابة الفعلية حصلوا على fresh (جوّه lockDisputedOrderForUpdate) — بنرجّع قراءة
    // طازة من الـDB بدل order القديمة عشان القيمة المرجّعة تطابق الحالة الحقيقية بالظبط.
    return (await this.orders.findOne({ where: { id: orderId } }))!;
  }
}
