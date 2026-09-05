import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditLogService } from '../audit/audit-log.service';
import { PaymentsService } from '../payments/payments.service';
import { PromoCodesService } from '../promotions/promo-codes.service';
import { PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from '../payments/entities/wallet.entity';
import { WalletTxType } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { SettingsService } from '../settings/settings.service';
import { CancellationReasonsService } from './cancellation-reasons.service';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CancellationAppliesTo } from './entities/cancellation-reason.entity';
import { Order, OrderPaymentStatus, OrderStatus } from './entities/order.entity';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderQueriesService } from './order-queries.service';
import { CUSTOMER_CANCELLABLE_STATUSES, canTransition } from './order-state-machine';

// نافذة الإلغاء المجاني الافتراضية بالدقايق — القيمة الحقيقية بتيجي من `settings`.
const CANCELLATION_FREE_WINDOW_FALLBACK_MINUTES = 5;

/**
 * **إلغاء العميل للطلب — الشريحة ٥ من تقسيم `OrdersService`** (تدقيق A-1).
 *
 * الإلغاء مش تغيير حالة بس: فيه **قرار مالي** جوّاه (رسوم إلغاء حسب مرحلة الطلب وسبب الإلغاء،
 * واسترداد اللي اتدفع، وفكّ كود الخصم لو اتستخدم). فصله بيخلي القرار ده مقروءًا في مكان واحد
 * بدل ما يكون بند وسط ٤٣٠٠ سطر.
 *
 * ٩ اعتماديات بدل الـ٢٥.
 */
@Injectable()
export class OrderCancellationService {
  private readonly logger = new Logger(OrderCancellationService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly queries: OrderQueriesService,
    private readonly cancellationReasonsService: CancellationReasonsService,
    private readonly promoCodesService: PromoCodesService,
    private readonly walletsService: WalletsService,
    private readonly paymentsService: PaymentsService,
    private readonly settingsService: SettingsService,
    private readonly auditLog: AuditLogService,
    private readonly events: EventEmitter2,
  ) {}

  async cancel(userId: string, orderId: string, dto: CancelOrderDto): Promise<Order> {
    const order = await this.queries.findOneOwnedOrThrow(userId, orderId);

    if (!CUSTOMER_CANCELLABLE_STATUSES.has(order.orderStatus)) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        `مينفعش تلغي الطلب وهو في حالة ${order.orderStatus}`,
        HttpStatus.CONFLICT,
      );
    }
    if (!canTransition(order.orderStatus, OrderStatus.CANCELLED_BY_CUSTOMER)) {
      throw new ApiException(ErrorCode.ORDR_003, 'انتقال حالة غير مسموح', HttpStatus.CONFLICT);
    }

    // سبب الإلغاء — ممكن يترتب عليه رسوم لو برّه نافذة الإلغاء المجاني.
    // ملحوظة: affects_technician_score مُخزّن بس مش بيأثر فعلياً على quality_score حالياً —
    // القاموس مالوش صيغة محددة لحساب التأثير ده (نفس مبدأ عدم اختراع أرقام مش موجودة في المواصفات).
    //
    // ثغرة حقيقية اتقفلت (docs/08 §112): السبب كان **اختياري بالكامل**، ورسوم الإلغاء بتتحسب
    // جوّه `if (dto.cancellation_reason_id)` بس. يعني اللي بيدفع الرسوم هو اللي بيقرر لو هي
    // تنطبق عليه أصلاً — يسيب الراديو من غير اختيار فيخرج بصفر رسوم مهما كانت سياسة الأدمن.
    // القاعدة دلوقتي: لو الأدمن معرّف أسباب إلغاء للعميل، الاختيار إجباري. لو مفيش أسباب معرّفة
    // خالص، الإلغاء بيفضل شغّال بنص حر (ما نقفلش على العميل باب الإلغاء بسبب داتا ناقصة).
    let feeCents = 0;
    let cancellationReasonId: string | null = null;
    if (!dto.cancellation_reason_id) {
      const availableReasons = await this.cancellationReasonsService.listActive(CancellationAppliesTo.CUSTOMER);
      if (availableReasons.length > 0) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'لازم تختار سبب الإلغاء من القايمة',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    if (dto.cancellation_reason_id) {
      const cancellationReason = await this.cancellationReasonsService.findOrThrow(dto.cancellation_reason_id);
      if (cancellationReason.appliesTo !== CancellationAppliesTo.CUSTOMER) {
        throw new ApiException(ErrorCode.VAL_001, 'سبب الإلغاء ده مش لإلغاء العميل', HttpStatus.BAD_REQUEST);
      }
      cancellationReasonId = cancellationReason.id;

      if (cancellationReason.chargesFee) {
        const freeWindowMinutes = await this.settingsService.getNumber(
          'orders.cancellation_free_window_min',
          CANCELLATION_FREE_WINDOW_FALLBACK_MINUTES,
        );
        const minutesSincePlaced = order.placedAt ? (Date.now() - order.placedAt.getTime()) / 60_000 : Infinity;
        if (minutesSincePlaced > freeWindowMinutes) {
          feeCents = Math.round((order.totalAmountCents * Number(cancellationReason.feePercentage)) / 100);
        }
      }
    }

    const previousStatus = order.orderStatus;
    const cancelledOrder = await this.dataSource.transaction(async (manager) => {
      const lockedOrder = await manager
        .createQueryBuilder(Order, 'order')
        .setLock('pessimistic_write')
        .where('order.id = :orderId', { orderId })
        .getOne();
      if (
        !lockedOrder ||
        lockedOrder.orderStatus !== previousStatus ||
        !CUSTOMER_CANCELLABLE_STATUSES.has(lockedOrder.orderStatus) ||
        !canTransition(lockedOrder.orderStatus, OrderStatus.CANCELLED_BY_CUSTOMER)
      ) {
        throw new ApiException(ErrorCode.ORDR_003, 'حالة الطلب اتغيّرت بالفعل — حاول تاني', HttpStatus.CONFLICT);
      }
      lockedOrder.orderStatus = OrderStatus.CANCELLED_BY_CUSTOMER;
      lockedOrder.cancelledAt = new Date();
      lockedOrder.cancelledByUserId = userId;
      lockedOrder.cancellationReasonId = cancellationReasonId;
      lockedOrder.cancellationFeeCents = feeCents;
      await manager.save(lockedOrder);

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: lockedOrder.id,
          previousStatus,
          newStatus: OrderStatus.CANCELLED_BY_CUSTOMER,
          changedByUserId: userId,
          changedByRole: 'customer',
          changeSource: OrderChangeSource.CUSTOMER,
          reason: dto.reason ?? null,
        }),
      );

      // ترجيع استخدام كود الخصم (لو الطلب استخدم واحد) — §24، راجع PromoCodesService.releaseUsage()
      await this.promoCodesService.releaseUsage(manager, lockedOrder.id);

      // رسوم الإلغاء بتتحصّل جوّه نفس الـ transaction — "الطلب اتلغى بس الرسوم متحصلتش" ميحصلش،
      // نفس فلسفة settleAndComplete في payments. allowNegativeBalance:true لأنها عقوبة مش دفع
      // اختياري (نفس نمط تعويض الشكاوى في support.service.ts).
      if (feeCents > 0) {
        const customerWallet = await this.walletsService.getOrCreateWallet(userId, WalletOwnerType.CUSTOMER, manager);
        const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID, manager);
        await this.walletsService.doubleEntry(
          {
            fromWalletId: customerWallet.id,
            toWalletId: platformWallet.id,
            amountCents: feeCents,
            transactionType: WalletTxType.PENALTY,
            referenceType: 'order',
            referenceId: lockedOrder.id,
            descriptionAr: `رسوم إلغاء طلب ${lockedOrder.orderNumber}`,
            allowNegativeBalance: true,
          },
          manager,
        );
      }
      return lockedOrder;
    });

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(
        cancelledOrder.id,
        cancelledOrder.orderNumber,
        previousStatus,
        OrderStatus.CANCELLED_BY_CUSTOMER,
        cancelledOrder.customerId,
        cancelledOrder.technicianId,
        dto.reason ?? null,
      ),
    );

    // بَقّة حقيقية اتلقطت واتصلحت (docs/08 §20.7): طلب مدفوع مسبقًا إلكترونيًا (كارت/InstaPay،
    // ADR-0013) كان لو العميل لغاه بنفسه (مش النظام) قبل ما أي تسوية أرباح فني تحصل، فلوسه
    // تفضل معلّقة (paymentStatus=PAID على طلب CANCELLED_BY_CUSTOMER نهائي) لحد ما أدمن يلاحظ
    // ويرد يدويًا — رغم إن نفس السيناريو المالي بالظبط كان بيتصرف صح تلقائيًا لو النظام هو اللي
    // لغى (order-auto-cancel.service.ts). برّه أي transaction عمدًا — نداء بوابة دفع خارجي حقيقي
    // مايصحش يكون جوّه transaction ممكن ترجع لورا (تفاصيل الأمان الكاملة في
    // PaymentsService.refundCancelledPrepaidOrder()). فشل الاسترداد هنا بيتلقط ويتسجّل بس
    // مايكسرش تجربة العميل — الطلب فضل ملغي صح حتى لو الاسترداد فشل واحتاج مراجعة يدوية.
    if (cancelledOrder.paymentStatus === OrderPaymentStatus.PAID) {
      try {
        await this.paymentsService.refundCancelledPrepaidOrder(
          cancelledOrder.id,
          `استرداد تلقائي — العميل لغى طلب مدفوع مسبقًا قبل بدء الشغل${dto.reason ? `: ${dto.reason}` : ''}`,
          'customer_cancel',
        );
      } catch (err) {
        this.auditLog
          .record({
            actorUserId: userId,
            actorRole: 'customer',
            action: 'order.refund_failed_needs_manual_review',
            entityType: 'order',
            entityId: cancelledOrder.id,
            newValues: { order_number: cancelledOrder.orderNumber, error: err instanceof Error ? err.message : String(err) },
          })
          .catch(() => {});
      }
    }

    return cancelledOrder;
  }
}
