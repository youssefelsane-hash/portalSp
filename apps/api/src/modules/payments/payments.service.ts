import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { CASH_COLLECTED_EVENT, CashCollectedEvent } from '../../common/events/cash-collected.event';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { CatalogService } from '../catalog/catalog.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianLevelsService } from '../technicians/technician-levels.service';
import { TechnicianStatsService } from '../technicians/technician-stats.service';
import { User } from '../auth/entities/user.entity';
import { Order, OrderPaymentStatus, OrderStatus } from '../orders/entities/order.entity';
import { OrderChangeSource, OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { canTransition } from '../orders/order-state-machine';
import { PAYMENT_GATEWAY, PaymentGateway } from './gateways/payment-gateway.interface';
import { FAWRY_GATEWAY, FawryGateway } from './gateways/fawry-gateway.interface';
import { Payment, PaymentGatewayStatus, PaymentMethod } from './entities/payment.entity';
import { Refund, RefundMethod, RefundStatus, RefundType } from './entities/refund.entity';
import { WebhookEvent, WebhookProcessingStatus } from './entities/webhook-event.entity';
import { WalletOwnerType } from './entities/wallet.entity';
import { WalletTxType } from './entities/wallet-transaction.entity';
import { WalletsService } from './wallets.service';
import { PLATFORM_SYSTEM_USER_ID } from './entities/wallet.entity';

const PAYABLE_ORDER_STATUSES = new Set([OrderStatus.WORK_COMPLETED, OrderStatus.AWAITING_PAYMENT]);

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(WebhookEvent) private readonly webhookEvents: Repository<WebhookEvent>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly walletsService: WalletsService,
    private readonly catalogService: CatalogService,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
    private readonly technicianLevelsService: TechnicianLevelsService,
    private readonly technicianStatsService: TechnicianStatsService,
    private readonly auditLog: AuditLogService,
    private readonly events: EventEmitter2,
    @Inject(PAYMENT_GATEWAY) private readonly paymentGateway: PaymentGateway,
    @Inject(FAWRY_GATEWAY) private readonly fawryGateway: FawryGateway,
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
    if (technicianEarningCents > 0 && order.technicianId) {
      const technicianProfile = await this.techniciansService.findByProfileIdOrThrow(order.technicianId);
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

      const previousStatus = order.orderStatus;
      await this.settleAndComplete(manager, order, PaymentMethod.CASH, technicianUserId, 'technician');

      return { payment, order, previousStatus };
    }).then(async ({ payment, order, previousStatus }) => {
      // بره الـ transaction عمداً — إعادة حساب الإحصائيات مهمة خلفية (§14.4)، مش جزء من قفل الطلب
      await this.technicianStatsService.enqueueRecalculation(technicianProfile.id);
      this.events.emit(
        CASH_COLLECTED_EVENT,
        new CashCollectedEvent(payment.id, order.id, order.orderNumber, payment.amountCents, technicianUserId),
      );
      // كانت فجوة موثّقة: انتقال COMPLETED كان بيحصل هنا من غير ما يصدّر order.status_changed
      // خالص — chat/README.md وnotifications/README.md كانوا موثّقين ده صراحة كسبب توقف قفل
      // الشات التلقائي 24 ساعة بعد اكتمال الطلب.
      this.events.emit(
        ORDER_STATUS_CHANGED_EVENT,
        new OrderStatusChangedEvent(order.id, order.orderNumber, previousStatus, OrderStatus.COMPLETED, order.customerId, order.technicianId),
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

      const previousStatus = lockedOrder.orderStatus;
      await this.settleAndComplete(manager, lockedOrder, PaymentMethod.WALLET, userId, 'customer');

      return {
        payment,
        orderId: lockedOrder.id,
        orderNumber: lockedOrder.orderNumber,
        customerId: lockedOrder.customerId,
        technicianId: lockedOrder.technicianId,
        previousStatus,
      };
    }).then(async ({ payment, orderId, orderNumber, customerId, technicianId, previousStatus }) => {
      // بره الـ transaction عمداً — نفس سبب collectCash فوق
      if (technicianId) {
        await this.technicianStatsService.enqueueRecalculation(technicianId);
      }
      // نفس الفجوة اللي اتقفلت في collectCash فوق — الدفع بالمحفظة كان بيقفل الطلب من غير
      // ما يصدّر order.status_changed برضو.
      this.events.emit(
        ORDER_STATUS_CHANGED_EVENT,
        new OrderStatusChangedEvent(orderId, orderNumber, previousStatus, OrderStatus.COMPLETED, customerId, technicianId),
      );
      return payment;
    });
  }

  /**
   * العميل بيبدأ دفع بالبطاقة — بيرجّع رابط iframe مستضاف عند بوابة الدفع (Paymob افتراضياً،
   * راجع gateways/paymob-gateway.service.ts) عشان الكلاينت يفتحه في WebView. الدفعة بتتسجّل
   * `pending` فوراً؛ التأكيد الفعلي (نجاح/فشل) بييجي بعد كده عبر `POST /webhooks/paymob` —
   * مفيش أي تسوية (settleAndComplete) بتحصل هنا، القفل النهائي بس لما البوابة تأكّد.
   */
  async payWithCard(userId: string, orderId: string, idempotencyKey: string): Promise<{ payment: Payment; redirectUrl: string }> {
    const existing = await this.payments.findOne({ where: { idempotencyKey } });
    if (existing) {
      if (existing.orderId !== orderId) {
        throw new ApiException(ErrorCode.PAY_003, 'مفتاح idempotency ده مستخدم قبل كده لطلب مختلف', HttpStatus.CONFLICT);
      }
      const existingRedirectUrl = (existing.gatewayResponse as { redirect_url?: string } | null)?.redirect_url;
      if (existingRedirectUrl) {
        // نفس المفتاح ورابط دفع سابق لسه موجود — إعادة استخدامه (retry حقيقي idempotent)
        return { payment: existing, redirectUrl: existingRedirectUrl };
      }
      if (existing.paymentStatus !== PaymentGatewayStatus.PENDING && existing.paymentStatus !== PaymentGatewayStatus.FAILED) {
        // نجحت/اترفضت نهائياً بطريقة تانية (مستحيل عملياً هنا، لكن دفاع رخيص) — مش قابلة لإعادة المحاولة
        throw new ApiException(ErrorCode.PAY_003, 'الدفعة دي في حالة نهائية بالفعل', HttpStatus.CONFLICT);
      }
      // وصل هنا يعني: محاولة سابقة اتسجّلت بس نداء البوابة فشل قبل ما ياخد رابط (شبكة/بوابة واقعة) —
      // بنعيد المحاولة بنفس صف الدفعة (مش بنعمل صف جديد)، عشان مايتضاعفش payment_number لكل retry.
      return this.initiateGatewayCharge(existing);
    }

    // فحص الإعداد الأول قبل ما نلمس الـ DB خالص — لو البوابة مش مُعدّة، أفضل نرفض فوراً بدل ما
    // نسيب صف payment بحالة pending معلّق من غير redirect_url.
    if (!this.paymentGateway.isConfigured) {
      throw new ApiException(
        ErrorCode.PAY_001,
        'الدفع بالبطاقة مش متاح دلوقتي — جرّب الدفع بالمحفظة أو الكاش',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const order = await this.loadPayableOrderForCustomer(userId, orderId);
    this.assertPayable(order);

    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);

    const paymentNumber = await this.dataSource.transaction((manager) => this.nextPaymentNumber(manager));
    const payment = this.payments.create({
      paymentNumber,
      orderId: order.id,
      customerId: customerProfile.id,
      amountCents: order.totalAmountCents,
      paymentMethod: PaymentMethod.CARD,
      paymentGateway: this.paymentGateway.providerName,
      paymentStatus: PaymentGatewayStatus.PENDING,
      idempotencyKey,
    });
    await this.payments.save(payment);

    return this.initiateGatewayCharge(payment);
  }

  /**
   * بيتنادى (1) أول مرة فوراً بعد إنشاء صف الدفعة، و(2) لو retry بنفس Idempotency-Key لصف
   * pending/failed قديم (نداء البوابة فشل قبل كده — شبكة/API واقعة، مش رفض دفع فعلي). بيعيد
   * استخدام نفس صف الدفعة دايماً — أبداً مبيعملش صف تاني لنفس المفتاح، عشان الـ retry يبقى
   * idempotent فعلاً مش مجرد تسمية. `payment.customerId` هو id بتاع customer_profiles (مش
   * users) — لازم findByProfileIdOrThrow عشان نوصل لـ userId ونجيب بيانات الفوترة.
   */
  private async initiateGatewayCharge(payment: Payment): Promise<{ payment: Payment; redirectUrl: string }> {
    if (!this.paymentGateway.isConfigured) {
      throw new ApiException(
        ErrorCode.PAY_001,
        'الدفع بالبطاقة مش متاح دلوقتي — جرّب الدفع بالمحفظة أو الكاش',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const customerProfile = await this.customerProfiles.findByProfileIdOrThrow(payment.customerId);
    const user = await this.users.findOne({ where: { id: customerProfile.userId } });
    const order = await this.orders.findOne({ where: { id: payment.orderId } });
    if (!user || !order) {
      throw new ApiException(ErrorCode.VAL_001, 'بيانات الدفعة غير مكتملة لإعادة المحاولة', HttpStatus.CONFLICT);
    }

    const [firstName, ...rest] = user.fullName.trim().split(/\s+/);
    try {
      const gatewayResult = await this.paymentGateway.createCardPayment({
        paymentId: payment.id,
        orderNumber: order.orderNumber,
        amountCents: payment.amountCents,
        currencyCode: 'EGP',
        customerFirstName: firstName || 'NA',
        customerLastName: rest.join(' ') || 'NA',
        customerEmail: user.email ?? `customer-${user.id}@baytak.app`,
        customerPhone: user.phoneNumber,
      });

      payment.gatewayResponse = { redirect_url: gatewayResult.redirectUrl, gateway_order_id: gatewayResult.gatewayOrderId };
      payment.paymentStatus = PaymentGatewayStatus.PENDING;
      await this.payments.save(payment);
      return { payment, redirectUrl: gatewayResult.redirectUrl };
    } catch (err) {
      // نداء البوابة فشل (شبكة/API واقعة، مش رفض دفع من عميل حقيقي) — الدفعة بتفضل قابلة
      // لإعادة المحاولة بنفس idempotency key (الفرع فوق في payWithCard بيتعامل معاها).
      payment.paymentStatus = PaymentGatewayStatus.FAILED;
      payment.failureCode = 'GATEWAY_REGISTRATION_FAILED';
      payment.failureMessage = err instanceof Error ? err.message : String(err);
      await this.payments.save(payment);
      throw err;
    }
  }

  /**
   * العميل بيطلب كود مرجعي FawryPay ("ادفع في أقرب فوري") — بيرجّع referenceNumber العميل
   * بياخده لمنفذ فوري ويدفعه كاش فعلياً هناك. نفس فلسفة payWithCard بالظبط (idempotency retry،
   * مفيش تسوية هنا خالص، التأكيد بعدين عبر POST /webhooks/fawry بس).
   */
  async payWithFawryReference(
    userId: string,
    orderId: string,
    idempotencyKey: string,
  ): Promise<{ payment: Payment; referenceNumber: string; expiresAt: Date }> {
    const existing = await this.payments.findOne({ where: { idempotencyKey } });
    if (existing) {
      if (existing.orderId !== orderId) {
        throw new ApiException(ErrorCode.PAY_003, 'مفتاح idempotency ده مستخدم قبل كده لطلب مختلف', HttpStatus.CONFLICT);
      }
      const existingRef = (existing.gatewayResponse as { reference_number?: string; expires_at?: string } | null);
      if (existingRef?.reference_number) {
        return { payment: existing, referenceNumber: existingRef.reference_number, expiresAt: new Date(existingRef.expires_at!) };
      }
      if (existing.paymentStatus !== PaymentGatewayStatus.PENDING && existing.paymentStatus !== PaymentGatewayStatus.FAILED) {
        throw new ApiException(ErrorCode.PAY_003, 'الدفعة دي في حالة نهائية بالفعل', HttpStatus.CONFLICT);
      }
      return this.initiateFawryCharge(existing);
    }

    if (!this.fawryGateway.isConfigured) {
      throw new ApiException(
        ErrorCode.PAY_001,
        'الدفع بكود فوري مش متاح دلوقتي — جرّب الدفع بالمحفظة أو الكاش أو الكارت',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const order = await this.loadPayableOrderForCustomer(userId, orderId);
    this.assertPayable(order);

    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);

    const paymentNumber = await this.dataSource.transaction((manager) => this.nextPaymentNumber(manager));
    const payment = this.payments.create({
      paymentNumber,
      orderId: order.id,
      customerId: customerProfile.id,
      amountCents: order.totalAmountCents,
      paymentMethod: PaymentMethod.FAWRY_REFERENCE,
      paymentGateway: this.fawryGateway.providerName,
      paymentStatus: PaymentGatewayStatus.PENDING,
      idempotencyKey,
    });
    await this.payments.save(payment);

    return this.initiateFawryCharge(payment);
  }

  private async initiateFawryCharge(payment: Payment): Promise<{ payment: Payment; referenceNumber: string; expiresAt: Date }> {
    if (!this.fawryGateway.isConfigured) {
      throw new ApiException(
        ErrorCode.PAY_001,
        'الدفع بكود فوري مش متاح دلوقتي — جرّب الدفع بالمحفظة أو الكاش أو الكارت',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const customerProfile = await this.customerProfiles.findByProfileIdOrThrow(payment.customerId);
    const user = await this.users.findOne({ where: { id: customerProfile.userId } });
    const order = await this.orders.findOne({ where: { id: payment.orderId } });
    if (!user || !order) {
      throw new ApiException(ErrorCode.VAL_001, 'بيانات الدفعة غير مكتملة لإعادة المحاولة', HttpStatus.CONFLICT);
    }

    try {
      const gatewayResult = await this.fawryGateway.createReference({
        paymentId: payment.id,
        orderNumber: order.orderNumber,
        amountCents: payment.amountCents,
        customerName: user.fullName,
        customerEmail: user.email ?? `customer-${user.id}@baytak.app`,
        customerMobile: user.phoneNumber,
      });

      payment.gatewayReference = gatewayResult.referenceNumber;
      payment.gatewayResponse = {
        reference_number: gatewayResult.referenceNumber,
        expires_at: gatewayResult.expiresAt.toISOString(),
        gateway_order_id: gatewayResult.gatewayOrderId,
      };
      payment.paymentStatus = PaymentGatewayStatus.PENDING;
      await this.payments.save(payment);
      return { payment, referenceNumber: gatewayResult.referenceNumber, expiresAt: gatewayResult.expiresAt };
    } catch (err) {
      payment.paymentStatus = PaymentGatewayStatus.FAILED;
      payment.failureCode = 'GATEWAY_REGISTRATION_FAILED';
      payment.failureMessage = err instanceof Error ? err.message : String(err);
      await this.payments.save(payment);
      throw err;
    }
  }

  /**
   * بيتنادى من WebhooksController بعد ما يتحقق التوقيع مسبقاً. بيسجّل الحدث في webhook_events
   * (حماية من معالجة مكررة عبر external_event_id UNIQUE)، وبعدين لو نجحت العملية بيعدّي بنفس
   * مسار settleAndComplete اللي collectCash/payWithWallet بيستخدموه — نفس نقطة التسوية الوحيدة
   * للنظام كله، الدفع بالبطاقة/الكود المرجعي مش استثناء. `paymentMethod` بيتحدد حسب البوابة
   * المستدعية (CARD لـ Paymob، FAWRY_REFERENCE لـ Fawry) عشان يتسجّل صح في order_status_history/audit.
   */
  async finalizeGatewayWebhook(
    externalEventId: string,
    eventType: string,
    provider: string,
    rawPayload: Record<string, unknown>,
    signatureValid: boolean,
    paymentId: string | null,
    succeeded: boolean,
    failureReason: string | null,
    gatewayTransactionId: string,
    paymentMethod: PaymentMethod = PaymentMethod.CARD,
  ): Promise<void> {
    const alreadyProcessed = await this.webhookEvents.findOne({ where: { externalEventId } });
    if (alreadyProcessed) {
      // نفس الحدث اتبعت تاني (retry شائع من كل بوابات الدفع) — رجّع نجاح من غير أي معالجة تانية.
      this.logger.log(`webhook مكرر اتجاهل: ${externalEventId} (اتعالج قبل كده)`);
      return;
    }

    const webhookEvent = this.webhookEvents.create({
      provider,
      eventType,
      externalEventId,
      payload: rawPayload,
      signatureValid,
      processingStatus: WebhookProcessingStatus.RECEIVED,
    });
    await this.webhookEvents.save(webhookEvent);

    if (!signatureValid) {
      webhookEvent.processingStatus = WebhookProcessingStatus.FAILED;
      webhookEvent.errorMessage = 'توقيع غير صحيح — الحدث اتجاهل';
      webhookEvent.processedAt = new Date();
      await this.webhookEvents.save(webhookEvent);
      this.logger.warn(`webhook برد توقيع غلط اترفض: ${externalEventId}`);
      return;
    }

    if (!paymentId) {
      webhookEvent.processingStatus = WebhookProcessingStatus.IGNORED;
      webhookEvent.errorMessage = 'مفيش payment_id في الحمولة';
      webhookEvent.processedAt = new Date();
      await this.webhookEvents.save(webhookEvent);
      return;
    }

    const payment = await this.payments.findOne({ where: { id: paymentId } });
    if (!payment) {
      webhookEvent.processingStatus = WebhookProcessingStatus.FAILED;
      webhookEvent.errorMessage = `دفعة غير موجودة: ${paymentId}`;
      webhookEvent.processedAt = new Date();
      await this.webhookEvents.save(webhookEvent);
      return;
    }

    if (payment.paymentStatus !== PaymentGatewayStatus.PENDING) {
      // اتعالجت قبل كده (idempotency على مستوى الدفعة نفسها، مش بس external_event_id) —
      // ممكن يحصل لو نفس البوابة بعتت حدثين بمعرّفين مختلفين لنفس العملية.
      webhookEvent.processingStatus = WebhookProcessingStatus.IGNORED;
      webhookEvent.errorMessage = `الدفعة already في حالة ${payment.paymentStatus}`;
      webhookEvent.processedAt = new Date();
      await this.webhookEvents.save(webhookEvent);
      return;
    }

    try {
      if (succeeded) {
        payment.gatewayTransactionId = gatewayTransactionId;
        payment.paymentStatus = PaymentGatewayStatus.SUCCEEDED;
        payment.completedAt = new Date();

        // settleAndComplete's changedByUserId لازم يكون users.id (FK على order_status_history)،
        // بينما payment.customerId هو customer_profiles.id — نفس فخ الـ id المختلط اللي
        // اتصلح قبل كده في payWithCard/initiateGatewayCharge، هنا في مكان تاني في نفس الفلو.
        const customerProfile = await this.customerProfiles.findByProfileIdOrThrow(payment.customerId);

        const { orderId, orderNumber, customerId, technicianId, previousStatus } = await this.dataSource.transaction(
          async (manager) => {
            await manager.save(payment);
            const lockedOrder = await manager
              .createQueryBuilder(Order, 'o')
              .setLock('pessimistic_write')
              .where('o.id = :orderId', { orderId: payment.orderId })
              .getOne();
            if (!lockedOrder) {
              throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
            }
            this.assertPayable(lockedOrder);
            const previousStatus = lockedOrder.orderStatus;
            await this.settleAndComplete(manager, lockedOrder, paymentMethod, customerProfile.userId, 'customer');
            return {
              orderId: lockedOrder.id,
              orderNumber: lockedOrder.orderNumber,
              customerId: lockedOrder.customerId,
              technicianId: lockedOrder.technicianId,
              previousStatus,
            };
          },
        );

        if (technicianId) {
          await this.technicianStatsService.enqueueRecalculation(technicianId);
        }
        this.events.emit(
          ORDER_STATUS_CHANGED_EVENT,
          new OrderStatusChangedEvent(orderId, orderNumber, previousStatus, OrderStatus.COMPLETED, customerId, technicianId),
        );
      } else {
        payment.gatewayTransactionId = gatewayTransactionId;
        payment.paymentStatus = PaymentGatewayStatus.FAILED;
        payment.failureCode = 'GATEWAY_DECLINED';
        payment.failureMessage = failureReason;
        payment.failedAt = new Date();
        await this.payments.save(payment);
        // مفيش تغيير في حالة الطلب — العميل يقدر يعيد المحاولة (بطاقة تانية، محفظة، كاش)
      }

      webhookEvent.processingStatus = WebhookProcessingStatus.PROCESSED;
      webhookEvent.processedAt = new Date();
      await this.webhookEvents.save(webhookEvent);
    } catch (err) {
      webhookEvent.processingStatus = WebhookProcessingStatus.FAILED;
      webhookEvent.errorMessage = err instanceof Error ? err.message : String(err);
      webhookEvent.processedAt = new Date();
      await this.webhookEvents.save(webhookEvent);
      this.logger.error(`فشل معالجة webhook ${externalEventId}`, err instanceof Error ? err.stack : err);
      throw err;
    }
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
