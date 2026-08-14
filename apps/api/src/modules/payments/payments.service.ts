import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { CASH_COLLECTED_EVENT, CashCollectedEvent } from '../../common/events/cash-collected.event';
import { ORDER_CREATED_EVENT, OrderCreatedEvent } from '../../common/events/order-created.event';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { CatalogService } from '../catalog/catalog.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { LoyaltySource } from '../promotions/entities/loyalty-transaction.entity';
import { LoyaltyService } from '../promotions/loyalty.service';
import { SettingsService } from '../settings/settings.service';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianLevelsService } from '../technicians/technician-levels.service';
import { TechnicianStatsService } from '../technicians/technician-stats.service';
import { User } from '../auth/entities/user.entity';
import { Order, OrderPaymentStatus, OrderStatus } from '../orders/entities/order.entity';
import { OrderChangeSource, OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { canTransition } from '../orders/order-state-machine';
import { computeDispatchDeferredUntil } from '../orders/deferred-dispatch.util';
import { PaymentProviderRegistry } from './gateways/payment-provider.registry';
import { Payment, PaymentGatewayStatus, PaymentMethod } from './entities/payment.entity';
import { Refund, RefundMethod, RefundStatus, RefundType } from './entities/refund.entity';
import { WebhookEvent, WebhookProcessingStatus } from './entities/webhook-event.entity';
import { WalletOwnerType } from './entities/wallet.entity';
import { WalletTxType } from './entities/wallet-transaction.entity';
import { WalletsService } from './wallets.service';
import { PLATFORM_SYSTEM_USER_ID } from './entities/wallet.entity';

const PAYABLE_ORDER_STATUSES = new Set([OrderStatus.WORK_COMPLETED, OrderStatus.AWAITING_PAYMENT]);
// طرق دفع مسبق (Card/InstaPay) — لازم تتأكد قبل ما التوزيع يبدأ (ADR-0013 §4، "PAY BEFORE DISPATCH").
const PREPAY_METHODS = new Set([PaymentMethod.CARD, PaymentMethod.INSTAPAY]);

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
    private readonly loyaltyService: LoyaltyService,
    private readonly settingsService: SettingsService,
    private readonly auditLog: AuditLogService,
    private readonly events: EventEmitter2,
    private readonly paymentProviders: PaymentProviderRegistry,
  ) {}

  /**
   * عمولة المنصة = عمولة الخدمة الأساسية + فرق مستوى الفني (سالب عادةً — مستوى أعلى يعني عمولة
   * منصة أقل، حافز جودة حقيقي). المجموع محدود بين 0 و100% دفاعياً حتى لو إعدادات المستوى غلط.
   */
  private async computeSettlement(
    order: Order,
  ): Promise<{ platformCommissionCents: number; technicianEarningCents: number; commissionRateApplied: number; warrantyDays: number }> {
    const service = await this.catalogService.findServiceOrThrow(order.serviceId);
    let commissionRateApplied = Number(service.commissionPercentage);

    if (order.technicianId) {
      const technicianProfile = await this.techniciansService.findByProfileIdOrThrow(order.technicianId);
      const levelConfig = await this.technicianLevelsService.getOrThrow(technicianProfile.currentLevel);
      commissionRateApplied += Number(levelConfig.commissionAdjustmentPercentage);
    }

    // هيكل الحجز الجديد (docs/06 §2.1، docs/07 الجزء ب) — فرق عمولة إضافي حسب booking_mode
    // (فرد/اعتماد/طوارئ)، قابل للتحكم الكامل من الأدمن عبر /admin/settings (migration 0052)،
    // مش قيمة ثابتة في الكود. بيتجمع فوق عمولة الخدمة + فرق مستوى الفني، مش بديل عنهم.
    const bookingModeAdjustment = await this.settingsService.getNumber(
      `commission.${order.bookingMode}_adjustment_percentage`,
      0,
    );
    commissionRateApplied += bookingModeAdjustment;
    commissionRateApplied = Math.min(100, Math.max(0, commissionRateApplied));

    const platformCommissionCents = Math.round((order.totalAmountCents * commissionRateApplied) / 100);
    const technicianEarningCents = order.totalAmountCents - platformCommissionCents;
    return { platformCommissionCents, technicianEarningCents, commissionRateApplied, warrantyDays: service.warrantyDays };
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

  /**
   * `PENDING_PAYMENT` (دفع قبل التوزيع، ADR-0013 §4) بيتقبل هنا كمان جنب PAYABLE_ORDER_STATUSES
   * العادية (بعد اكتمال الشغل) — نفس آلية إنشاء الدفعة (Payment row + redirect/reference +
   * انتظار webhook/تأكيد) بالظبط، الفرق بس في التسوية بعد النجاح (handlePaymentConfirmed تحت
   * بتفرّق بين "يبدأ التوزيع" و"يقفل الطلب مكتمل"). كاش/محفظة عمليًا مش بيوصلوا PENDING_PAYMENT
   * أصلاً (الطلب بيتعمل SEARCHING_TECHNICIAN فورًا لو payment_method مش كارت/InstaPay).
   */
  private assertPayable(order: Order): void {
    if (order.paymentStatus === OrderPaymentStatus.PAID) {
      throw new ApiException(ErrorCode.PAY_003, 'الطلب مدفوع بالفعل', HttpStatus.CONFLICT);
    }
    if (order.orderStatus === OrderStatus.PENDING_PAYMENT) {
      return;
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
   * بتتنادى بعد ما دفع مسبق (كارت/InstaPay) يتأكد فعليًا (webhook ناجح أو تأكيد إداري لـInstaPay).
   * بتفرّق بين حالتين مختلفتين جوهريًا كانت settleAndComplete وحدها بتخلطهم قبل كده (ADR-0013 §4):
   * - الطلب PENDING_PAYMENT (لسه ما اتوزّعش) → يفضل مفتوح، بس ينتقل لـSEARCHING_TECHNICIAN
   *   (التوزيع يبدأ بعدها مباشرة عبر ORDER_CREATED_EVENT، مش settleAndComplete اللي بتقفل الطلب).
   * - الطلب WORK_COMPLETED/AWAITING_PAYMENT (المسار الحالي، دفع بعد اكتمال الشغل) → settleAndComplete
   *   زي ما هي بالظبط، صفر تغيير سلوكي.
   */
  private async handlePaymentConfirmed(
    manager: EntityManager,
    order: Order,
    paymentMethod: PaymentMethod,
    changedByUserId: string,
    changedByRole: 'customer' | 'system',
  ): Promise<{ dispatchStarted: boolean }> {
    if (order.orderStatus === OrderStatus.PENDING_PAYMENT) {
      const previousStatus = order.orderStatus;
      order.orderStatus = OrderStatus.SEARCHING_TECHNICIAN;
      order.paymentStatus = OrderPaymentStatus.PAID;
      order.paymentMethod = paymentMethod;
      await manager.save(order);
      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: OrderStatus.SEARCHING_TECHNICIAN,
          changedByUserId,
          changedByRole: changedByRole === 'system' ? 'system' : 'customer',
          changeSource: changedByRole === 'system' ? OrderChangeSource.SYSTEM : OrderChangeSource.CUSTOMER,
          reason: 'الدفع اتأكد — التوزيع بدأ',
        }),
      );
      return { dispatchStarted: true };
    }

    await this.settleAndComplete(manager, order, paymentMethod, changedByUserId, changedByRole === 'system' ? 'customer' : changedByRole);
    return { dispatchStarted: false };
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
    const { platformCommissionCents, technicianEarningCents, commissionRateApplied, warrantyDays } =
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
    // الضمان (docs/08 §7) — بيتفعّل بس لو الخدمة عندها warranty_days > 0. صفر = مفيش ضمان،
    // warranty_expires_at بيفضل null (مش تاريخ في الماضي مضلّل).
    order.warrantyExpiresAt = warrantyDays > 0 ? new Date(now.getTime() + warrantyDays * 24 * 60 * 60 * 1000) : null;
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

    // كسب نقاط ولاء تلقائي — كانت فجوة موثّقة صراحة ("معدل الكسب مالوش رقم في القاموس، مش
    // هنخترعه") لحد ما اتضاف إعداد قابل للتعديل من /settings (loyalty.earn_points_per_100_egp_spent
    // — راجع migration 0043). بيحصل جوّه نفس transaction التسوية (manager مُمرّر لـ earn())
    // عشان الذرّية، نفس مبدأ تحويل أرباح الفني فوق. طلبات أقل من 100ج (بمعدل 1 نقطة/100ج
    // الافتراضي) مبتكسبش نقاط — سلوك متوقع، مش فشل.
    const earnRatePer100Egp = await this.settingsService.getNumber('loyalty.earn_points_per_100_egp_spent', 1);
    const pointsEarned = Math.floor(order.totalAmountCents / 10000) * earnRatePer100Egp;
    if (pointsEarned > 0) {
      const customerProfile = await this.customerProfiles.findByProfileIdOrThrow(order.customerId);
      await this.loyaltyService.earn(customerProfile.userId, pointsEarned, LoyaltySource.ORDER, order.id, null, manager);
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
      await this.technicianStatsService.enqueueRecalculation(technicianProfile.id, order.serviceId);
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

      // العميل بيدفع لمحفظة المنصة كاملة (مش رصيد غير كافٍ مسموح هنا — ده فلوس حقيقية للعميل).
      // إعادة زيارة تحت الضمان (docs/08 §7) مجانية بالكامل (totalAmountCents=0) — مفيش قيد
      // محفظة يتعمل خالص هنا (doubleEntry بترفض أي مبلغ صفر أو أقل بتصميمها)، بس لسه بيتسجّل
      // Payment وبتكمّل settleAndComplete تحت عشان الطلب يقفل صح ويوصل لحالة COMPLETED.
      if (lockedOrder.totalAmountCents > 0) {
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
      }

      const previousStatus = lockedOrder.orderStatus;
      await this.settleAndComplete(manager, lockedOrder, PaymentMethod.WALLET, userId, 'customer');

      return {
        payment,
        orderId: lockedOrder.id,
        orderNumber: lockedOrder.orderNumber,
        customerId: lockedOrder.customerId,
        technicianId: lockedOrder.technicianId,
        serviceId: lockedOrder.serviceId,
        previousStatus,
      };
    }).then(async ({ payment, orderId, orderNumber, customerId, technicianId, serviceId, previousStatus }) => {
      // بره الـ transaction عمداً — نفس سبب collectCash فوق
      if (technicianId) {
        await this.technicianStatsService.enqueueRecalculation(technicianId, serviceId);
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
   * نقطة دفع موحّدة لأي طريقة بتمر على PaymentProvider حقيقي (كارت/فوري/InstaPay — مش
   * كاش/محفظة، دول ليهم مسار مباشر تمامًا). بتتعامل مع idempotency retry (نفس المفتاح، صف قديم
   * pending/failed) وإنشاء دفعة جديدة، وبترجّع نتيجة CreatePaymentResult الخام عشان كل طريقة
   * تستخرج منها الشكل اللي بتحتاجه (redirect_url لكارت، reference_code لفوري/InstaPay).
   * `orderId` هنا اللي بيتحدد منه إن كان الطلب PENDING_PAYMENT (دفع قبل التوزيع، ADR-0013 §4)
   * أو WORK_COMPLETED/AWAITING_PAYMENT (المسار العادي بعد الشغل) — assertPayable() بتقبل الاتنين.
   */
  private async payWithProvider(
    userId: string,
    orderId: string,
    idempotencyKey: string,
    method: PaymentMethod,
  ): Promise<{ payment: Payment; result: import('./gateways/payment-provider.interface').CreatePaymentResult }> {
    const provider = this.paymentProviders.getProvider(method);

    const existing = await this.payments.findOne({ where: { idempotencyKey } });
    if (existing) {
      if (existing.orderId !== orderId) {
        throw new ApiException(ErrorCode.PAY_003, 'مفتاح idempotency ده مستخدم قبل كده لطلب مختلف', HttpStatus.CONFLICT);
      }
      const cachedResult = (existing.gatewayResponse as { cached_result?: unknown } | null)?.cached_result;
      if (cachedResult) {
        return {
          payment: existing,
          result: cachedResult as import('./gateways/payment-provider.interface').CreatePaymentResult,
        };
      }
      if (existing.paymentStatus !== PaymentGatewayStatus.PENDING && existing.paymentStatus !== PaymentGatewayStatus.FAILED) {
        throw new ApiException(ErrorCode.PAY_003, 'الدفعة دي في حالة نهائية بالفعل', HttpStatus.CONFLICT);
      }
      return { payment: existing, result: await this.initiateProviderCharge(existing, method) };
    }

    if (!provider.isConfigured) {
      throw new ApiException(ErrorCode.PAY_001, `الدفع بـ${method} مش متاح دلوقتي — جرّب طريقة تانية`, HttpStatus.SERVICE_UNAVAILABLE);
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
      paymentMethod: method,
      paymentGateway: provider.providerKey,
      paymentStatus: PaymentGatewayStatus.PENDING,
      idempotencyKey,
    });
    await this.payments.save(payment);

    return { payment, result: await this.initiateProviderCharge(payment, method) };
  }

  /**
   * بيتنادى (1) أول مرة فوراً بعد إنشاء صف الدفعة، و(2) لو retry بنفس Idempotency-Key لصف
   * pending/failed قديم. بيعيد استخدام نفس صف الدفعة دايماً — idempotent فعلاً مش مجرد تسمية.
   */
  private async initiateProviderCharge(
    payment: Payment,
    method: PaymentMethod,
  ): Promise<import('./gateways/payment-provider.interface').CreatePaymentResult> {
    const provider = this.paymentProviders.getProvider(method);
    if (!provider.isConfigured) {
      throw new ApiException(ErrorCode.PAY_001, `الدفع بـ${method} مش متاح دلوقتي — جرّب طريقة تانية`, HttpStatus.SERVICE_UNAVAILABLE);
    }

    const customerProfile = await this.customerProfiles.findByProfileIdOrThrow(payment.customerId);
    const user = await this.users.findOne({ where: { id: customerProfile.userId } });
    const order = await this.orders.findOne({ where: { id: payment.orderId } });
    if (!user || !order) {
      throw new ApiException(ErrorCode.VAL_001, 'بيانات الدفعة غير مكتملة لإعادة المحاولة', HttpStatus.CONFLICT);
    }

    const [firstName, ...rest] = user.fullName.trim().split(/\s+/);
    try {
      const result = await provider.createPayment({
        paymentId: payment.id,
        orderNumber: order.orderNumber,
        amountCents: payment.amountCents,
        currencyCode: 'EGP',
        customerFirstName: firstName || 'NA',
        customerLastName: rest.join(' ') || 'NA',
        customerEmail: user.email ?? `customer-${user.id}@baytak.app`,
        customerPhone: user.phoneNumber,
      });

      if (result.kind === 'redirect' || result.kind === 'reference') {
        payment.gatewayReference = result.providerReference;
      }
      payment.gatewayResponse = { cached_result: result };
      payment.paymentStatus = PaymentGatewayStatus.PENDING;
      await this.payments.save(payment);
      return result;
    } catch (err) {
      // نداء البوابة فشل (شبكة/API واقعة، مش رفض دفع من عميل حقيقي) — الدفعة بتفضل قابلة
      // لإعادة المحاولة بنفس idempotency key.
      payment.paymentStatus = PaymentGatewayStatus.FAILED;
      payment.failureCode = 'GATEWAY_REGISTRATION_FAILED';
      payment.failureMessage = err instanceof Error ? err.message : String(err);
      await this.payments.save(payment);
      throw err;
    }
  }

  /**
   * العميل بيبدأ دفع بالبطاقة — بيرجّع رابط Unified Checkout عند Paymob (ADR-0013، Intention API)
   * عشان الكلاينت يفتحه في WebView. الدفعة بتتسجّل `pending` فوراً؛ التأكيد الفعلي بييجي بعد كده
   * عبر `POST /webhooks/paymob` — مفيش أي تسوية بتحصل هنا، القفل النهائي بس لما البوابة تأكّد.
   */
  async payWithCard(userId: string, orderId: string, idempotencyKey: string): Promise<{ payment: Payment; redirectUrl: string }> {
    const { payment, result } = await this.payWithProvider(userId, orderId, idempotencyKey, PaymentMethod.CARD);
    if (result.kind !== 'redirect') {
      throw new Error('Paymob provider لازم يرجّع redirect دايماً — نتيجة غير متوقعة');
    }
    return { payment, redirectUrl: result.checkoutUrl };
  }

  /**
   * العميل بيطلب كود مرجعي FawryPay ("ادفع في أقرب فوري") — بيرجّع referenceNumber العميل
   * بياخده لمنفذ فوري ويدفعه كاش فعلياً هناك. التأكيد بعدين عبر POST /webhooks/fawry بس.
   */
  async payWithFawryReference(
    userId: string,
    orderId: string,
    idempotencyKey: string,
  ): Promise<{ payment: Payment; referenceNumber: string; expiresAt: Date | null }> {
    const { payment, result } = await this.payWithProvider(userId, orderId, idempotencyKey, PaymentMethod.FAWRY_REFERENCE);
    if (result.kind !== 'reference') {
      throw new Error('Fawry provider لازم يرجّع reference دايماً — نتيجة غير متوقعة');
    }
    return { payment, referenceNumber: result.referenceCode, expiresAt: result.expiresAt };
  }

  /**
   * InstaPay — مسبق الدفع بتأكيد يدوي بس (ADR-0013 §7). بيرجّع تعليمات التحويل، مفيش webhook
   * تلقائي خالص — موظف Finance مُصرَّح له بس هو اللي بيأكّد الاستلام عبر confirmInstaPayPayment().
   */
  async payWithInstaPay(
    userId: string,
    orderId: string,
    idempotencyKey: string,
  ): Promise<{ payment: Payment; referenceCode: string; instructionsAr: string }> {
    const { payment, result } = await this.payWithProvider(userId, orderId, idempotencyKey, PaymentMethod.INSTAPAY);
    if (result.kind !== 'reference') {
      throw new Error('InstaPay provider لازم يرجّع reference دايماً — نتيجة غير متوقعة');
    }
    return { payment, referenceCode: result.referenceCode, instructionsAr: result.instructionsAr };
  }

  /**
   * تأكيد إداري يدوي لدفعة InstaPay (ADR-0013 §7، صلاحية payments.confirm_manual مخصوصة —
   * فرض جوّه AdminPaymentsController@RequirePermission). Idempotent فعليًا: قفل pessimistic_write
   * على صف الدفعة + فحص PENDING جوّه القفل — نقر مزدوج/إعادة إرسال بيرجع نفس النتيجة بلا أثر مالي
   * مكرر. Audit كامل (الموظف، الوقت، المبلغ، معرّف الطلب/الدفعة، الحالة قبل/بعد) في الكولر
   * (admin-payments.controller.ts) بعد النجاح — نفس نمط refundOrder بالحرف.
   */
  async confirmInstaPayPayment(adminUserId: string, paymentId: string, meta?: AuditActorMeta): Promise<Payment> {
    const previousStatus = (await this.payments.findOne({ where: { id: paymentId } }))?.paymentStatus ?? null;

    const { payment, dispatchInfo } = await this.dataSource.transaction(async (manager) => {
      const lockedPayment = await manager
        .createQueryBuilder(Payment, 'p')
        .setLock('pessimistic_write')
        .where('p.id = :paymentId', { paymentId })
        .getOne();
      if (!lockedPayment) {
        throw new ApiException(ErrorCode.VAL_001, 'الدفعة غير موجودة', HttpStatus.NOT_FOUND);
      }
      if (lockedPayment.paymentMethod !== PaymentMethod.INSTAPAY) {
        throw new ApiException(ErrorCode.PAY_003, 'الدفعة دي مش InstaPay', HttpStatus.CONFLICT);
      }
      if (lockedPayment.paymentStatus !== PaymentGatewayStatus.PENDING) {
        // Idempotency — نقر مزدوج/إعادة إرسال بيرجع نفس الدفعة من غير أي أثر مالي إضافي.
        return { payment: lockedPayment, dispatchInfo: null };
      }

      lockedPayment.paymentStatus = PaymentGatewayStatus.SUCCEEDED;
      lockedPayment.completedAt = new Date();
      lockedPayment.collectedByUserId = adminUserId;
      await manager.save(lockedPayment);

      const lockedOrder = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId: lockedPayment.orderId })
        .getOne();
      if (!lockedOrder) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
      }

      const { dispatchStarted } = await this.handlePaymentConfirmed(manager, lockedOrder, PaymentMethod.INSTAPAY, adminUserId, 'system');
      return {
        payment: lockedPayment,
        dispatchInfo: {
          dispatchStarted,
          orderId: lockedOrder.id,
          orderNumber: lockedOrder.orderNumber,
          customerId: lockedOrder.customerId,
          technicianId: lockedOrder.technicianId,
          serviceId: lockedOrder.serviceId,
        },
      };
    });

    if (dispatchInfo) {
      await this.emitPaymentConfirmedEvents(dispatchInfo);
    }

    // Audit كامل (§27/§7 من توجيه المالك) — الموظف، الوقت، المبلغ، معرّف الطلب/الدفعة، الحالة
    // قبل/بعد. بيتسجّل حتى لو idempotent no-op (نقر مزدوج) عشان يبان في السجل إن محاولة تانية حصلت.
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'payment.instapay_confirmed_manually',
      entityType: 'payment',
      entityId: paymentId,
      oldValues: { payment_status: previousStatus },
      newValues: {
        payment_status: payment.paymentStatus,
        amount_cents: payment.amountCents,
        order_id: payment.orderId,
        reference: payment.gatewayReference,
      },
      meta,
    });

    return payment;
  }

  /** بعد نجاح handlePaymentConfirmed — بره أي transaction عمداً (نفس فلسفة باقي أحداث الموديول). */
  private async emitPaymentConfirmedEvents(info: {
    dispatchStarted: boolean;
    orderId: string;
    orderNumber: string;
    customerId: string;
    technicianId: string | null;
    serviceId: string;
  }): Promise<void> {
    if (info.dispatchStarted) {
      // دفع قبل التوزيع اتأكد — التوزيع يبدأ دلوقتي بالظبط زي OrdersService.create() العادية
      // (نفس منطق تأجيل البث لطلب مجدول "بعيد"، ADR-0009).
      const order = await this.orders.findOne({ where: { id: info.orderId } });
      const leadHours = await this.settingsService.getNumber('matching.deferred_dispatch_lead_hours', 4);
      const dispatchDeferredUntil = computeDispatchDeferredUntil({
        scheduleSlotBooked: false,
        scheduledAt: order?.scheduledAt ?? null,
        leadHours,
      });
      await this.events.emitAsync(ORDER_CREATED_EVENT, new OrderCreatedEvent(info.orderId, dispatchDeferredUntil));
      this.events.emit(
        ORDER_STATUS_CHANGED_EVENT,
        new OrderStatusChangedEvent(
          info.orderId,
          info.orderNumber,
          OrderStatus.PENDING_PAYMENT,
          OrderStatus.SEARCHING_TECHNICIAN,
          info.customerId,
          info.technicianId,
        ),
      );
    } else {
      if (info.technicianId) {
        await this.technicianStatsService.enqueueRecalculation(info.technicianId, info.serviceId);
      }
      this.events.emit(
        ORDER_STATUS_CHANGED_EVENT,
        new OrderStatusChangedEvent(
          info.orderId,
          info.orderNumber,
          OrderStatus.WORK_COMPLETED,
          OrderStatus.COMPLETED,
          info.customerId,
          info.technicianId,
        ),
      );
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
    webhookAmountCents: number | null = null,
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

    /**
     * بَقّة أمنية/مالية حقيقية اتلقطت واتصلحت (مراجعة أمان شاملة 2026-08-13، P0-7): الـwebhook
     * كان بيثق في `succeeded=true` من البوابة ويسوّي الطلب بالكامل من غير أي مقارنة بين المبلغ
     * اللي وصل فعلاً (`amountCents` من الـwebhook نفسه) والمبلغ المتوقع (`payment.amountCents`
     * المسجّل وقت إنشاء الدفعة). توقيع HMAC بيمنع مهاجم عشوائي من تزوير حدث، لكن مبيحميش من خطأ
     * إعداد/تكامل حقيقي في البوابة نفسها (partial payment، عملة مختلفة، bug في البوابة) يسوّي
     * طلب بمبلغ أقل من قيمته الحقيقية. الفحص هنا مستقل عن HMAC عمداً — طبقة حماية إضافية، مش بديل.
     */
    if (succeeded && webhookAmountCents !== null && webhookAmountCents !== payment.amountCents) {
      webhookEvent.processingStatus = WebhookProcessingStatus.FAILED;
      webhookEvent.errorMessage = `المبلغ في الـwebhook (${webhookAmountCents}) مايطابقش المبلغ المتوقع (${payment.amountCents}) — الحدث اترفض بأمان`;
      webhookEvent.processedAt = new Date();
      await this.webhookEvents.save(webhookEvent);
      this.logger.error(
        `webhook برد مبلغ غير متطابق اترفض: ${externalEventId} — دفعة ${paymentId} متوقّع ${payment.amountCents} ووصل ${webhookAmountCents}`,
      );
      return;
    }

    try {
      if (succeeded) {
        payment.gatewayTransactionId = gatewayTransactionId;
        payment.paymentStatus = PaymentGatewayStatus.SUCCEEDED;
        payment.completedAt = new Date();

        // handlePaymentConfirmed's changedByUserId لازم يكون users.id (FK على order_status_history)،
        // بينما payment.customerId هو customer_profiles.id — نفس فخ الـ id المختلط اللي
        // اتصلح قبل كده في payWithCard/initiateGatewayCharge، هنا في مكان تاني في نفس الفلو.
        const customerProfile = await this.customerProfiles.findByProfileIdOrThrow(payment.customerId);

        const dispatchInfo = await this.dataSource.transaction(async (manager) => {
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
          // بتفرّق بين "الطلب PENDING_PAYMENT، التوزيع لسه ما بدأش" و"الطلب WORK_COMPLETED
          // العادي بعد الشغل" — نفس مسار confirmInstaPayPayment بالظبط (ADR-0013 §4).
          const { dispatchStarted } = await this.handlePaymentConfirmed(manager, lockedOrder, paymentMethod, customerProfile.userId, 'customer');
          return {
            dispatchStarted,
            orderId: lockedOrder.id,
            orderNumber: lockedOrder.orderNumber,
            customerId: lockedOrder.customerId,
            technicianId: lockedOrder.technicianId,
            serviceId: lockedOrder.serviceId,
          };
        });

        await this.emitPaymentConfirmedEvents(dispatchInfo);
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
   * استرجاع كامل/جزئي (ADR-0013 §9) — بيحاول استرداد حقيقي عبر بوابة الدفع الأصلية الأول
   * (Paymob مثلاً)، وبيرجع لـwallet credit بس للطرق اللي مش بتدعم استرداد حقيقي (كاش/محفظة/
   * InstaPay/فوري). لو البوابة رفضت الاسترداد صراحة (رد نهائي، مش خطأ شبكة)، بيتسجّل
   * refund_status=rejected بلا أي حركة فلوس — أبداً مبيتقالش "اترد" من غير ما الفلوس ترجع فعلاً.
   * خطأ شبكة/داخلي غير متوقّع بيرمي الاستثناء عادي (transaction بترجع لورا، مفيش صف refund
   * اتسجّل خالص) عشان الأدمن يقدر يعيد المحاولة — مش قفل دائم زي الرفض النهائي.
   */
  async refundOrder(
    performedByUserId: string,
    orderId: string,
    reasonNotes: string,
    requestedAmountCents?: number,
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

      // Phase 1 مبسّطة عمداً (ADR-0013 §9 + unique index idx_refunds_payment_id_unique): استرداد
      // واحد أقصى لكل دفعة، سواء كامل أو جزئي — مفيش تراكم استردادات جزئية متعددة لسه.
      const existingRefund = await manager.findOne(Refund, { where: { paymentId: payment.id } });
      if (existingRefund) {
        throw new ApiException(ErrorCode.PAY_003, 'الطلب ده اترد قبل كده', HttpStatus.CONFLICT);
      }

      const amountCents = requestedAmountCents ?? payment.amountCents;
      if (amountCents <= 0 || amountCents > payment.amountCents) {
        throw new ApiException(ErrorCode.VAL_001, 'مبلغ الاسترداد غير صالح — لازم يكون بين 1 والمبلغ المدفوع', HttpStatus.BAD_REQUEST);
      }
      const isFull = amountCents === payment.amountCents;

      // استرداد كامل بيغيّر حالة الطلب لـREFUNDED (نهائية) — لازم يمر بـcanTransition. استرداد
      // جزئي مايغيّرش orderStatus خالص (الطلب يفضل COMPLETED/DISPUTED)، فمفيش داعي لفحص انتقال حالة.
      if (isFull && !canTransition(order.orderStatus, OrderStatus.REFUNDED)) {
        throw new ApiException(ErrorCode.ORDR_003, 'انتقال حالة غير مسموح', HttpStatus.CONFLICT);
      }
      if (!isFull && order.orderStatus !== OrderStatus.COMPLETED && order.orderStatus !== OrderStatus.DISPUTED) {
        throw new ApiException(ErrorCode.ORDR_003, 'الطلب لازم يكون مكتمل أو متنازع عليه عشان يترد جزئيًا', HttpStatus.CONFLICT);
      }

      const provider = this.paymentProviders.getProvider(payment.paymentMethod);
      let refundMethod: RefundMethod;
      let refundStatus: RefundStatus;
      let providerRefundId: string | null = null;

      if (provider.supportsRefund && payment.gatewayTransactionId) {
        // نداء حقيقي للبوابة — لو رمى استثناء (شبكة/خطأ غير متوقّع) بيتصاعد زي ما هو، الـtransaction
        // بترجع لورا ومفيش صف refund بيتسجّل خالص، فالأدمن يقدر يعيد المحاولة بأمان (مش رفض نهائي).
        const providerResult = await provider.refund({
          providerReference: payment.gatewayTransactionId,
          amountCents,
          reasonAr: reasonNotes,
        });
        if (providerResult.succeeded) {
          refundMethod = RefundMethod.ORIGINAL_METHOD;
          refundStatus = RefundStatus.COMPLETED;
          providerRefundId = providerResult.providerRefundId;
        } else {
          // رد نهائي من البوابة نفسها (رفض صريح، مش خطأ شبكة) — ده قرار نهائي حسب تبسيط Phase 1،
          // بيتسجّل rejected بلا أي حركة فلوس (مفيش استرداد حقيقي حصل، فمفيش داعي لعكس أي شيء).
          const refundNumber = await this.nextRefundNumber(manager);
          const rejectedRefund = manager.create(Refund, {
            refundNumber,
            paymentId: payment.id,
            orderId: order.id,
            amountCents,
            refundType: isFull ? RefundType.FULL : RefundType.PARTIAL,
            reasonNotes,
            refundMethod: RefundMethod.ORIGINAL_METHOD,
            refundStatus: RefundStatus.REJECTED,
            requestedByUserId: performedByUserId,
            approvedByUserId: performedByUserId,
            requestedAt: new Date(),
            approvedAt: new Date(),
            completedAt: null,
            providerRefundId: null,
          });
          await manager.save(rejectedRefund);
          return rejectedRefund;
        }
      } else {
        // مفيش استرداد حقيقي مدعوم لطريقة الدفع دي (كاش/محفظة/InstaPay/فوري) — نفس الإصلاح
        // الصادق من قبل: wallet credit فعلي بدل رقم "مكتمل" كاذب من غير حركة فلوس.
        refundMethod = RefundMethod.WALLET_CREDIT;
        refundStatus = RefundStatus.COMPLETED;
      }

      const refundNumber = await this.nextRefundNumber(manager);
      const refund = manager.create(Refund, {
        refundNumber,
        paymentId: payment.id,
        orderId: order.id,
        amountCents,
        refundType: isFull ? RefundType.FULL : RefundType.PARTIAL,
        reasonNotes,
        refundMethod,
        refundStatus,
        requestedByUserId: performedByUserId,
        approvedByUserId: performedByUserId,
        requestedAt: new Date(),
        approvedAt: new Date(),
        completedAt: new Date(),
        providerRefundId,
      });
      await manager.save(refund);

      // عكس تحويل أرباح الفني بنفس نسبة مبلغ الاسترداد من إجمالي الدفعة — الفني ماخدش الفلوس دي
      // كاملة أصلاً لو الاسترداد جزئي.
      const technicianReversalCents = Math.round((order.technicianEarningCents * amountCents) / payment.amountCents);
      if (technicianReversalCents > 0 && order.technicianId) {
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
            amountCents: technicianReversalCents,
            transactionType: WalletTxType.REFUND,
            referenceType: 'refund',
            referenceId: refund.id,
            descriptionAr: `استرجاع أرباح طلب ${order.orderNumber}`,
            allowNegativeBalance: true, // ممكن الفني يكون صرف الفلوس دي بالفعل — الدين ده هيتسوّى في الصرف الجاي
          },
          manager,
        );
      }

      // wallet credit فعلي للعميل بس لو مفيش استرداد حقيقي حصل عند البوابة (WALLET_CREDIT fallback).
      // لو استرداد حقيقي نجح عند البوابة (ORIGINAL_METHOD)، العميل بياخد فلوسه فعليًا في كارته/محفظته
      // الخارجية مباشرة من البوابة — credit تاني هنا هيبقى استرداد مزدوج (بَقّة مالية، مش سلوك مقصود).
      if (refundMethod === RefundMethod.WALLET_CREDIT) {
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
            amountCents,
            transactionType: WalletTxType.REFUND,
            referenceType: 'refund',
            referenceId: refund.id,
            descriptionAr: `استرجاع طلب ${order.orderNumber}`,
            allowNegativeBalance: true,
          },
          manager,
        );
      }

      payment.paymentStatus = isFull ? PaymentGatewayStatus.REFUNDED : PaymentGatewayStatus.PARTIALLY_REFUNDED;
      await manager.save(payment);

      if (isFull) {
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
      } else {
        // استرداد جزئي — الطلب يفضل زي ما هو (COMPLETED/DISPUTED)، بس paymentStatus بيتحدّث
        // عشان يبان في تاريخ الطلب إن جزء اترد.
        order.paymentStatus = OrderPaymentStatus.PARTIALLY_REFUNDED;
        await manager.save(order);
      }

      return refund;
    });

    await this.auditLog.record({
      actorUserId: performedByUserId,
      actorRole: 'admin',
      action: refund.refundStatus === RefundStatus.REJECTED ? 'order.refund_rejected' : 'order.refunded',
      entityType: 'order',
      entityId: orderId,
      newValues: {
        refund_id: refund.id,
        amount_cents: refund.amountCents,
        refund_type: refund.refundType,
        refund_method: refund.refundMethod,
        refund_status: refund.refundStatus,
        provider_refund_id: refund.providerRefundId,
        reason_notes: reasonNotes,
      },
      meta,
    });
    return refund;
  }
}
