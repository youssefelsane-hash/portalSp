import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { CASH_COLLECTED_EVENT, CashCollectedEvent } from '../../common/events/cash-collected.event';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { CatalogService } from '../catalog/catalog.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianLevelsService } from '../technicians/technician-levels.service';
import { TechnicianStatsService } from '../technicians/technician-stats.service';
import { Order, OrderPaymentStatus, OrderStatus } from '../orders/entities/order.entity';
import { OrderChangeSource, OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { canTransition } from '../orders/order-state-machine';
import { Payment, PaymentGatewayStatus, PaymentMethod } from './entities/payment.entity';
import { Refund, RefundMethod, RefundStatus, RefundType } from './entities/refund.entity';
import { WalletOwnerType } from './entities/wallet.entity';
import { WalletTxType } from './entities/wallet-transaction.entity';
import { WalletsService } from './wallets.service';
import { PLATFORM_SYSTEM_USER_ID } from './entities/wallet.entity';

const PAYABLE_ORDER_STATUSES = new Set([OrderStatus.WORK_COMPLETED, OrderStatus.AWAITING_PAYMENT]);

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly walletsService: WalletsService,
    private readonly catalogService: CatalogService,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
    private readonly technicianLevelsService: TechnicianLevelsService,
    private readonly technicianStatsService: TechnicianStatsService,
    private readonly auditLog: AuditLogService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * عمولة المنصة = عمولة الخدمة الأساسية + فرق مستوى الفني (سالب عادةً — مستوى أعلى يعني عمولة
   * منصة أقل، حافز جودة حقيقي). المجموع محدود بين 0 و100% دفاعياً حتى لو إعدادات المستوى غلط.
   */
  private async computeSettlement(order: Order): Promise<{ platformCommissionCents: number; technicianEarningCents: number; commissionRateApplied: number }> {
    const service = await this.catalogService.findServiceOrThrow(order.serviceId);
    let commissionRateApplied = Number(service.commissionPercentage);

    if (order.technicianId) {
      const technicianProfile = await this.techniciansService.findByProfileIdOrThrow(order.technicianId);
      const levelConfig = await this.technicianLevelsService.getOrThrow(technicianProfile.currentLevel);
      commissionRateApplied += Number(levelConfig.commissionAdjustmentPercentage);
      commissionRateApplied = Math.min(100, Math.max(0, commissionRateApplied));
    }

    const platformCommissionCents = Math.round((order.totalAmountCents * commissionRateApplied) / 100);
    const technicianEarningCents = order.totalAmountCents - platformCommissionCents;
    return { platformCommissionCents, technicianEarningCents, commissionRateApplied };
  }

  /** بيتأكد إن الطلب فعلاً بتاع العميل ده وفي حالة قابلة للدفع، وبيرجع صف الطلب. */
  private async loadPayableOrderForCustomer(userId: string, orderId: string): Promise<Order> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);
    const order = await this.orders.findOne({ where: { id: orderId, customerId: customerProfile.id } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
    }
    return order;
  }

  private assertPayable(order: Order): void {
    if (order.paymentStatus === OrderPaymentStatus.PAID) {
      throw new ApiException(ErrorCode.PAY_003, 'الطلب مدفوع بالفعل', HttpStatus.CONFLICT);
    }
    if (!PAYABLE_ORDER_STATUSES.has(order.orderStatus)) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        `مينفعش تدفع للطلب وهو في حالة ${order.orderStatus} — لازم الشغل يخلص الأول`,
        HttpStatus.CONFLICT,
      );
    }
  }

  /**
   * تسوية موحّدة تُستخدم لكل طرق الدفع: بتحسب عمولة المنصة وأرباح الفني، بتقفل الطلب كمدفوع
   * ومكتمل، وبتسجّل قيد تحويل الأرباح من محفظة المنصة لمحفظة الفني — كل ده جوّه transaction واحدة
   * مع تحديث الطلب، عشان "الطلب اتقفل بس الفلوس متحولتش" ميحصلش أبداً.
   */
  private async settleAndComplete(
    manager: EntityManager,
    order: Order,
    paymentMethod: PaymentMethod,
    changedByUserId: string,
    changedByRole: 'customer' | 'technician' | 'system',
  ): Promise<Order> {
    const { platformCommissionCents, technicianEarningCents, commissionRateApplied } =
      await this.computeSettlement(order);

    if (!canTransition(order.orderStatus, OrderStatus.COMPLETED)) {
      throw new ApiException(ErrorCode.ORDR_003, 'انتقال حالة غير مسموح', HttpStatus.CONFLICT);
    }

    const previousStatus = order.orderStatus;
    const now = new Date();
    order.paymentStatus = OrderPaymentStatus.PAID;
    order.paymentMethod = paymentMethod;
    order.platformCommissionCents = platformCommissionCents;
    order.technicianEarningCents = technicianEarningCents;
    order.commissionRateApplied = String(commissionRateApplied);
    order.paidAt = now;
    order.orderStatus = OrderStatus.COMPLETED;
    order.closedAt = now;
    await manager.save(order);

    await manager.save(
      manager.create(OrderStatusHistory, {
        orderId: order.id,
        previousStatus,
        newStatus: OrderStatus.COMPLETED,
        changedByUserId,
        changedByRole,
        changeSource:
          changedByRole === 'customer'
            ? OrderChangeSource.CUSTOMER
            : changedByRole === 'technician'
              ? OrderChangeSource.TECHNICIAN
              : OrderChangeSource.SYSTEM,
      }),
    );

    // عمولة المنصة والفني بتتسوّى دايماً عبر محفظة المنصة، حتى في الكاش — الفني فعلياً
    // ماسك الكاش من العميل، فده تسوية محاسبية داخلية مش تحويل فلوس حقيقي (موثّق في README).
    if (technicianEarningCents > 0) {
      const technicianProfile = await this.techniciansService.findByProfileIdOrThrow(order.technicianId!);
      const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);
      const technicianWallet = await this.walletsService.getOrCreateWallet(
        technicianProfile.userId,
        WalletOwnerType.TECHNICIAN,
      );

      await this.walletsService.doubleEntry(
        {
          fromWalletId: platformWallet.id,
          toWalletId: technicianWallet.id,
          amountCents: technicianEarningCents,
          transactionType: WalletTxType.ORDER_EARNING,
          referenceType: 'order',
          referenceId: order.id,
          descriptionAr: `أرباح طلب ${order.orderNumber}`,
          allowNegativeBalance: true, // محفظة المنصة تمثيل محاسبي، مش رصيد حقيقي محدود
        },
        manager,
      );
    }

    return order;
  }

  /** الفني بيأكّد إنه استلم الكاش من العميل — أكتر طريقة دفع شائعة في مصر (§11 في الماستر بلان). */
  async collectCash(technicianUserId: string, orderId: string): Promise<Payment> {
    const technicianProfile = await this.techniciansService.findByUserIdOrThrow(technicianUserId);

    return this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId AND o.technicianId = :technicianId', {
          orderId,
          technicianId: technicianProfile.id,
        })
        .getOne();

      if (!order) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
      }
      this.assertPayable(order);

      const paymentNumber = await this.nextPaymentNumber(manager);
      const payment = manager.create(Payment, {
        paymentNumber,
        orderId: order.id,
        customerId: order.customerId,
        amountCents: order.totalAmountCents,
        paymentMethod: PaymentMethod.CASH,
        paymentStatus: PaymentGatewayStatus.SUCCEEDED,
        idempotencyKey: `cash:${order.id}`, // كاش مالوش تكرار من الكلاينت أصلاً، بس بنحافظ على نفس العقد
        completedAt: new Date(),
        collectedByUserId: technicianUserId,
      });
      await manager.save(payment);

      await this.settleAndComplete(manager, order, PaymentMethod.CASH, technicianUserId, 'technician');

      return { payment, order };
    }).then(async ({ payment, order }) => {
      // بره الـ transaction عمداً — إعادة حساب الإحصائيات مهمة خلفية (§14.4)، مش جزء من قفل الطلب
      await this.technicianStatsService.enqueueRecalculation(technicianProfile.id);
      this.events.emit(
        CASH_COLLECTED_EVENT,
        new CashCollectedEvent(payment.id, order.id, order.orderNumber, payment.amountCents, technicianUserId),
      );
      return payment;
    });
  }

  /** العميل بيدفع من رصيد محفظته — لازم Idempotency-Key عشان لو نفس الطلب اتبعت مرتين بالغلط. */
  async payWithWallet(userId: string, orderId: string, idempotencyKey: string): Promise<Payment> {
    const existing = await this.payments.findOne({ where: { idempotencyKey } });
    if (existing) {
      if (existing.orderId !== orderId) {
        throw new ApiException(ErrorCode.PAY_003, 'مفتاح idempotency ده مستخدم قبل كده لطلب مختلف', HttpStatus.CONFLICT);
      }
      return existing; // نفس الطلب بنفس المفتاح — عملية مكررة، رجّع نفس النتيجة من غير ما نعمل حاجة تانية
    }

    const order = await this.loadPayableOrderForCustomer(userId, orderId);
    this.assertPayable(order);

    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);
    const customerWallet = await this.walletsService.getOrCreateWallet(userId, WalletOwnerType.CUSTOMER);
    const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);

    return this.dataSource.transaction(async (manager) => {
      // نعيد تحميل الطلب جوّه الـ transaction بقفل — نفس سبب accept() في matching:
      // لو حد تاني بيدفعه بالتوازي (مستحيل نظرياً لأنه نفس العميل، لكن الدفاع رخيص وواضح)
      const lockedOrder = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();
      if (!lockedOrder) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
      }
      this.assertPayable(lockedOrder);

      const paymentNumber = await this.nextPaymentNumber(manager);
      const payment = manager.create(Payment, {
        paymentNumber,
        orderId: lockedOrder.id,
        customerId: customerProfile.id,
        amountCents: lockedOrder.totalAmountCents,
        paymentMethod: PaymentMethod.WALLET,
        paymentStatus: PaymentGatewayStatus.SUCCEEDED,
        idempotencyKey,
        completedAt: new Date(),
      });
      await manager.save(payment);

      // العميل بيدفع لمحفظة المنصة كاملة (مش رصيد غير كافٍ مسموح هنا — ده فلوس حقيقية للعميل)
      await this.walletsService.doubleEntry(
        {
          fromWalletId: customerWallet.id,
          toWalletId: platformWallet.id,
          amountCents: lockedOrder.totalAmountCents,
          transactionType: WalletTxType.ADJUSTMENT,
          referenceType: 'payment',
          referenceId: payment.id,
          descriptionAr: `دفع طلب ${lockedOrder.orderNumber}`,
        },
        manager,
      );

      await this.settleAndComplete(manager, lockedOrder, PaymentMethod.WALLET, userId, 'customer');

      return { payment, technicianId: lockedOrder.technicianId };
    }).then(async ({ payment, technicianId }) => {
      // بره الـ transaction عمداً — نفس سبب collectCash فوق
      if (technicianId) {
        await this.technicianStatsService.enqueueRecalculation(technicianId);
      }
      return payment;
    });
  }

  private async nextPaymentNumber(manager: EntityManager): Promise<string> {
    const [{ next_human_readable_number: number }] = await manager.query<
      { next_human_readable_number: string }[]
    >("SELECT next_human_readable_number('PAY')");
    return number;
  }

  private async nextRefundNumber(manager: EntityManager): Promise<string> {
    const [{ next_human_readable_number: number }] = await manager.query<
      { next_human_readable_number: string }[]
    >("SELECT next_human_readable_number('REF')");
    return number;
  }

  /**
   * استرجاع كامل — بيعكس قيود المحفظة اللي اتعملت وقت الدفع (لو الدفع كان محفظة/كاش سُوّي عبر
   * المنصة)، وبيرجّع الطلب لحالة refunded. مسموح بس لو الطلب مدفوع فعلاً.
   */
  async refundOrder(
    performedByUserId: string,
    orderId: string,
    reasonNotes: string,
    meta?: AuditActorMeta,
  ): Promise<Refund> {
    const refund = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();
      if (!order) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
      }
      if (order.paymentStatus !== OrderPaymentStatus.PAID) {
        throw new ApiException(ErrorCode.PAY_003, 'الطلب لازم يكون مدفوع الأول عشان يترد', HttpStatus.CONFLICT);
      }

      const payment = await manager.findOne(Payment, {
        where: { orderId, paymentStatus: PaymentGatewayStatus.SUCCEEDED },
        order: { completedAt: 'DESC' },
      });
      if (!payment) {
        throw new ApiException(ErrorCode.VAL_001, 'مفيش عملية دفع ناجحة لقى الطلب ده', HttpStatus.NOT_FOUND);
      }

      const existingRefund = await manager.findOne(Refund, { where: { paymentId: payment.id } });
      if (existingRefund) {
        throw new ApiException(ErrorCode.PAY_003, 'الطلب ده اترد قبل كده', HttpStatus.CONFLICT);
      }

      if (!canTransition(order.orderStatus, OrderStatus.REFUNDED)) {
        throw new ApiException(ErrorCode.ORDR_003, 'انتقال حالة غير مسموح', HttpStatus.CONFLICT);
      }

      const refundNumber = await this.nextRefundNumber(manager);
      const refund = manager.create(Refund, {
        refundNumber,
        paymentId: payment.id,
        orderId: order.id,
        amountCents: payment.amountCents,
        refundType: RefundType.FULL,
        reasonNotes,
        refundMethod: payment.paymentMethod === PaymentMethod.CASH ? RefundMethod.WALLET_CREDIT : RefundMethod.ORIGINAL_METHOD,
        refundStatus: RefundStatus.COMPLETED,
        requestedByUserId: performedByUserId,
        approvedByUserId: performedByUserId,
        requestedAt: new Date(),
        approvedAt: new Date(),
        completedAt: new Date(),
      });
      await manager.save(refund);

      // عكس تحويل أرباح الفني (لو اتسوّى) — الفني ماخدش الفلوس دي أصلاً بقى
      if (order.technicianEarningCents > 0 && order.technicianId) {
        const technicianProfile = await this.techniciansService.findByProfileIdOrThrow(order.technicianId);
        const technicianWallet = await this.walletsService.getOrCreateWallet(
          technicianProfile.userId,
          WalletOwnerType.TECHNICIAN,
        );
        const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);

        await this.walletsService.doubleEntry(
          {
            fromWalletId: technicianWallet.id,
            toWalletId: platformWallet.id,
            amountCents: order.technicianEarningCents,
            transactionType: WalletTxType.REFUND,
            referenceType: 'refund',
            referenceId: refund.id,
            descriptionAr: `استرجاع أرباح طلب ${order.orderNumber}`,
            allowNegativeBalance: true, // ممكن الفني يكون صرف الفلوس دي بالفعل — الدين ده هيتسوّى في الصرف الجاي
          },
          manager,
        );
      }

      // الدفع بالمحفظة: فلوس العميل كانت فعلاً عند المنصة، فبترجعلها من هناك مباشرة.
      // الدفع بالكاش: العميل دفع للفني يداً بيد، مفيش فلوس دخلت المنصة أصلاً — لكن المنصة لسه
      // قادرة ترجّع له تعويض في محفظته، ممول من عكس أرباح الفني اللي فوق (نفس المبلغ بالظبط)،
      // عشان كده refundMethod=WALLET_CREDIT في الحالة دي فعلاً بيتنفّذ مش مجرد تسمية.
      if (payment.paymentMethod === PaymentMethod.WALLET || payment.paymentMethod === PaymentMethod.CASH) {
        const customerProfile = await this.customerProfiles.findByProfileIdOrThrow(order.customerId);
        const customerWallet = await this.walletsService.getOrCreateWallet(
          customerProfile.userId,
          WalletOwnerType.CUSTOMER,
        );
        const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);

        await this.walletsService.doubleEntry(
          {
            fromWalletId: platformWallet.id,
            toWalletId: customerWallet.id,
            amountCents: payment.amountCents,
            transactionType: WalletTxType.REFUND,
            referenceType: 'refund',
            referenceId: refund.id,
            descriptionAr: `استرجاع طلب ${order.orderNumber}`,
            allowNegativeBalance: true,
          },
          manager,
        );
      }

      payment.paymentStatus = PaymentGatewayStatus.REFUNDED;
      await manager.save(payment);

      const previousStatus = order.orderStatus;
      order.orderStatus = OrderStatus.REFUNDED;
      order.paymentStatus = OrderPaymentStatus.REFUNDED;
      await manager.save(order);
      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: OrderStatus.REFUNDED,
          changedByUserId: performedByUserId,
          changedByRole: 'admin',
          changeSource: OrderChangeSource.ADMIN,
          reason: reasonNotes,
        }),
      );

      return refund;
    });

    await this.auditLog.record({
      actorUserId: performedByUserId,
      actorRole: 'admin',
      action: 'order.refunded',
      entityType: 'order',
      entityId: orderId,
      newValues: { refund_id: refund.id, amount_cents: refund.amountCents, reason_notes: reasonNotes },
      meta,
    });
    return refund;
  }
}
