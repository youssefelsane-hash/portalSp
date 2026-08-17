import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { CASH_COLLECTED_EVENT, CashCollectedEvent } from '../../common/events/cash-collected.event';
import {
  ADDITIONAL_WORK_PAYMENT_RESOLVED_EVENT,
  AdditionalWorkPaymentResolvedEvent,
} from '../../common/events/additional-work-payment.event';
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
import {
  WebhookEvent,
  WebhookProcessingStage,
  WebhookProcessingStatus,
} from './entities/webhook-event.entity';
import { WalletOwnerType } from './entities/wallet.entity';
import { WalletTransaction, WalletTxType } from './entities/wallet-transaction.entity';
import { WalletAdjustment } from './entities/wallet-adjustment.entity';
import { WalletsService } from './wallets.service';
import { PLATFORM_SYSTEM_USER_ID } from './entities/wallet.entity';
import { SavedPaymentMethodsService } from './saved-payment-methods.service';

const PAYABLE_ORDER_STATUSES = new Set([OrderStatus.WORK_COMPLETED, OrderStatus.AWAITING_PAYMENT]);
// طرق دفع مسبق (Card/InstaPay) — لازم تتأكد قبل ما التوزيع يبدأ (ADR-0013 §4، "PAY BEFORE DISPATCH").
const PREPAY_METHODS = new Set([PaymentMethod.CARD, PaymentMethod.INSTAPAY]);
const WEBHOOK_RECOVERY_MAX_ATTEMPTS_FALLBACK = 5;
const WEBHOOK_RECOVERY_BASE_DELAY_SECONDS_FALLBACK = 30;

type PaymentConfirmedEffects = {
  dispatchStarted: boolean;
  orderId: string;
  orderNumber: string;
  customerId: string;
  technicianId: string | null;
  serviceId: string;
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Refund) private readonly refunds: Repository<Refund>,
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
    private readonly savedPaymentMethods: SavedPaymentMethodsService,
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
   *
   * **إصلاح بَقّة حرجة (ADR-0015)**: كانت `paymentStatus === PAID` وحدها كافية للرفض — بس طلب
   * مدفوع مسبقًا (كارت/InstaPay قبل التوزيع) بيوصل `paymentStatus=PAID` من لحظة تأكيد الدفع، قبل
   * ما الفني يوصل حتى، فمفيش أي مسار تسوية كان يقدر يعدّي بعد اكتمال الشغل — الطلب يفضل عالق في
   * WORK_COMPLETED للأبد (اتأكدت حيًا). التمييز الصح: `PAID` + `AWAITING_PAYMENT` معناها "فيه
   * مبلغ إضافي (دلتا) لسه مستني تحصيل بعد بند إضافي اتوافق عليه بعد الدفع المسبق" — ده الحالة
   * الوحيدة اللي `settleAlreadyPaidOrder()` تحت بتحط الطلب فيها، فمسموح بيها هنا. أي حالة تانية
   * فيها `PAID` (يعني الطلب اتقفل خلاص عبر `settleAndComplete()`) تفضل مرفوضة زي زمان بالظبط.
   */
  private assertPayable(order: Order): void {
    if (order.paymentStatus === OrderPaymentStatus.PAID && order.orderStatus !== OrderStatus.AWAITING_PAYMENT) {
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
   * المبلغ المطلوب تحصيله دلوقتي فعليًا (ADR-0015) — مش دايمًا `order.totalAmountCents` بالكامل.
   * لطلب عادي (`paymentStatus` لسه `UNPAID`) بيرجع الإجمالي كامل، صفر تغيير سلوكي عن زمان. لطلب
   * مدفوع مسبقًا وصل `AWAITING_PAYMENT` (فيه دلتا مستنية بعد بند إضافي، `assertPayable()` فوق
   * سمحت بيه تحديدًا للحالة دي)، بيرجع الفرق بين الإجمالي الحالي والمبلغ اللي فعلاً اتحصّل قبل
   * التوزيع — تحصيل المبلغ الكامل تاني هنا كان هيبقى تحصيل مزدوج حقيقي.
   */
  /**
   * **إصلاح بَقّة حقيقية (docs/08 §21)**: كانت بتاخد بس أول دفعة ناجحة (`completedAt ASC`) وتطرحها
   * من `totalAmountCents` — صح لما أقصى دفعتين ممكنتين للطلب (الأصلية + دلتا واحدة بعدها)، بس غلط
   * دلوقتي إن محاولة تحصيل شغل إضافي إلكتروني ممكن تنجح **قبل** اكتمال الشغل (docs/08 §21 بند 5) —
   * لو نجحت، الطلب ممكن يبقى عنده أكتر من دفعة ناجحة قبل ما يوصل حتى لنقطة فحص الاكتمال، ودالة
   * "أول دفعة بس" كانت هتتجاهل التحصيل الإضافي الناجح ده وتطلب المبلغ تاني (تحصيل مزدوج حقيقي).
   * الإصلاح: مجموع **كل** الدفعات الناجحة للطلب، مش أولها بس.
   */
  private async amountOwedNow(order: Order, manager?: EntityManager): Promise<number> {
    if (order.paymentStatus !== OrderPaymentStatus.PAID) {
      return order.totalAmountCents;
    }
    const paymentsRepo = manager ? manager.getRepository(Payment) : this.payments;
    const succeededPayments = await paymentsRepo.find({
      where: { orderId: order.id, paymentStatus: PaymentGatewayStatus.SUCCEEDED },
    });
    if (succeededPayments.length === 0) {
      // دفاعي بحت — مفروض مستحيل عمليًا (paymentStatus=PAID لازم كان مسبوق بدفعة ناجحة)، لو حصل
      // نرجّع صفر بدل ما نحصّل مبلغ عشوائي مش موثوق.
      return 0;
    }
    const totalCollectedCents = succeededPayments.reduce((sum, p) => sum + p.amountCents, 0);
    return Math.max(0, order.totalAmountCents - totalCollectedCents);
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

    // تسوية اتجاه الفلوس الصح حسب مين ماسك الكاش فعليًا (docs/08 §20 بند 2/3/4) — كانت بَقّة
    // محاسبية جوهرية: settleAndComplete() كانت دايمًا بتحوّل technicianEarningCents من محفظة
    // المنصة لمحفظة الفني بغض النظر عن طريقة الدفع، وكأن المنصة هي اللي ماسكة الفلوس دايمًا.
    // ده صحيح للطرق الإلكترونية (wallet/card/instapay/fawry — المنصة فعلاً استلمت الفلوس عبر
    // البوابة/محفظة العميل الداخلية)، بس **غلط تمامًا للكاش**: الفني بياخد المبلغ الكامل من
    // العميل يدًا بيد، فمفروض هو اللي مديون للمنصة بالعمولة، مش العكس. النتيجة العملية للبَقّة
    // القديمة: طلب كاش 1000ج (عمولة 200/أرباح 800) كان بيخلّي رصيد محفظة الفني +800 كأن المنصة
    // مدينة له، فيقدر يطلب صرف 800ج إضافيين فوق الـ1000ج اللي ماسكها بالفعل — فلوس مضاعفة حقيقية.
    //
    // **الحل عام لأي مزيج دفع، مش مجرد فحص paymentMethod الحالي**: بند إضافي بعد دفع مسبق
    // إلكتروني (ADR-0015) ممكن يتحصّل جزء منه كاش والباقي كارت لنفس الطلب — فبنحسب كام فعليًا
    // الفني ماسكه كاش **لنفس الطلب ده** (مجموع كل صفوف payments بـpayment_method=cash وpayment_status=succeeded،
    // بما فيها الدفعة الحالية اللي اتسجّلت قبل نداء الدالة دي مباشرة)، ونقارنه بنصيب الفني العادل
    // (technicianEarningCents، محسوب على الإجمالي النهائي الكامل زي ما هو دايمًا). الفرق (net)
    // هو الحركة الوحيدة المطلوبة، باتجاهها الصحيح:
    // - net > 0 → المنصة ماسكة فلوس أكتر من نصيب الفني (الحالة الإلكترونية العادية، أو كاش جزئي
    //   بس مش كل حاجة) → تحويل عادي من محفظة المنصة لمحفظة الفني (ORDER_EARNING)، زي زمان بالحرف.
    // - net < 0 → الفني ماسك كاش أكتر من نصيبه العادل (كاش كامل، أو كاش أكتر من نصيبه) → الفني
    //   مديون للمنصة بالفرق، خصم من محفظته لمحفظة المنصة (COMMISSION_DEDUCTION — كانت موجودة في
    //   enum WalletTxType من زمان بلا أي استخدام حقيقي، أول استهلاك ليها هنا).
    // - net = 0 → مفيش حركة مطلوبة خالص (الفني ماسك بالظبط نصيبه العادل، نادر بس ممكن).
    //
    // `refundOrder()` يطبّق عكس الأرباح متناسبًا مع إجمالي الطلب، لا الدفعـة المختارة وحدها؛
    // ده ضروري للدفعات الإضافية الصغيرة حتى يظل العكس متسقًا مع التسوية المركّبة هنا.
    if (order.technicianId) {
      const technicianProfile = await this.techniciansService.findByProfileIdOrThrow(order.technicianId);
      const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);
      const technicianWallet = await this.walletsService.getOrCreateWallet(
        technicianProfile.userId,
        WalletOwnerType.TECHNICIAN,
      );

      const cashSumRow = await manager
        .createQueryBuilder(Payment, 'p')
        .select('COALESCE(SUM(p.amount_cents), 0)', 'cash_collected_cents')
        .where('p.order_id = :orderId AND p.payment_method = :cashMethod AND p.payment_status = :succeeded', {
          orderId: order.id,
          cashMethod: PaymentMethod.CASH,
          succeeded: PaymentGatewayStatus.SUCCEEDED,
        })
        .getRawOne<{ cash_collected_cents: string }>();
      const cashHeldByTechnicianCents = Number(cashSumRow?.cash_collected_cents ?? 0);
      const netMovementCents = technicianEarningCents - cashHeldByTechnicianCents;

      if (netMovementCents > 0) {
        await this.walletsService.doubleEntry(
          {
            fromWalletId: platformWallet.id,
            toWalletId: technicianWallet.id,
            amountCents: netMovementCents,
            transactionType: WalletTxType.ORDER_EARNING,
            referenceType: 'order',
            referenceId: order.id,
            descriptionAr: `أرباح طلب ${order.orderNumber}`,
            allowNegativeBalance: true, // محفظة المنصة تمثيل محاسبي، مش رصيد حقيقي محدود
          },
          manager,
        );
      } else if (netMovementCents < 0) {
        await this.walletsService.doubleEntry(
          {
            fromWalletId: technicianWallet.id,
            toWalletId: platformWallet.id,
            amountCents: -netMovementCents,
            transactionType: WalletTxType.COMMISSION_DEDUCTION,
            referenceType: 'order',
            referenceId: order.id,
            descriptionAr: `عمولة كاش طلب ${order.orderNumber} — الفني ماسك المبلغ كامل يدًا بيد`,
            allowNegativeBalance: true, // دَين مشروع على الفني (هيتسوّى في الصرف الجاي)، مش سحب فوق رصيد حقيقي
          },
          manager,
        );
      }
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
      // المبلغ المستحق دلوقتي (ADR-0015) — الإجمالي كامل للطلب العادي، أو الدلتا بس لو الطلب كان
      // مدفوع مسبقًا ولسه مستني تحصيل بند إضافي (AWAITING_PAYMENT).
      const owedNowCents = await this.amountOwedNow(order, manager);

      const paymentNumber = await this.nextPaymentNumber(manager);
      const payment = manager.create(Payment, {
        paymentNumber,
        orderId: order.id,
        customerId: order.customerId,
        amountCents: owedNowCents,
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

  /**
   * تأكيد أدمن يدوي إن الكاش فعلاً اتحصّل — بعد مراجعة نزاع تسليم كاش (docs/08 §22 بند 13-14،
   * OrdersService.resolveCashHandoverDispute outcome='confirm_received'). نفس منطق collectCash()
   * بالحرف (Payment + settleAndComplete) بس من DISPUTED مش WORK_COMPLETED/AWAITING_PAYMENT،
   * وبلا فحص ملكية فني (الأدمن مش الفني اللي بينفّذ هنا — الصلاحية والـstep-up MFA مفروضين على
   * مستوى الـcontroller/OrdersService.resolveCashHandoverDispute).
   */
  async adminConfirmCashReceived(adminUserId: string, orderId: string, meta?: AuditActorMeta): Promise<Payment> {
    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();
      if (!order) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
      }
      if (order.orderStatus !== OrderStatus.DISPUTED || !order.technicianCashNotReceivedAt) {
        throw new ApiException(ErrorCode.ORDR_003, 'الطلب ده مش نزاع تسليم كاش قيد المراجعة', HttpStatus.CONFLICT);
      }
      const owedNowCents = await this.amountOwedNow(order, manager);

      const paymentNumber = await this.nextPaymentNumber(manager);
      const payment = manager.create(Payment, {
        paymentNumber,
        orderId: order.id,
        customerId: order.customerId,
        amountCents: owedNowCents,
        paymentMethod: PaymentMethod.CASH,
        paymentStatus: PaymentGatewayStatus.SUCCEEDED,
        idempotencyKey: `cash-admin-confirmed:${order.id}`,
        completedAt: new Date(),
        collectedByUserId: adminUserId,
      });
      await manager.save(payment);

      const previousStatus = order.orderStatus;
      await this.settleAndComplete(manager, order, PaymentMethod.CASH, adminUserId, 'system');

      return { payment, order, previousStatus };
    });

    const { payment, order, previousStatus } = result;
    if (order.technicianId) {
      await this.technicianStatsService.enqueueRecalculation(order.technicianId, order.serviceId);
    }
    this.events.emit(
      CASH_COLLECTED_EVENT,
      new CashCollectedEvent(payment.id, order.id, order.orderNumber, payment.amountCents, adminUserId),
    );
    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(order.id, order.orderNumber, previousStatus, OrderStatus.COMPLETED, order.customerId, order.technicianId),
    );
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'order.cash_dispute_resolved_confirmed',
      entityType: 'order',
      entityId: order.id,
      newValues: { amount_cents: payment.amountCents },
      meta,
    });

    return payment;
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
      // المبلغ المستحق دلوقتي (ADR-0015) — راجع تعليق collectCash فوق لنفس المنطق بالحرف.
      const owedNowCents = await this.amountOwedNow(lockedOrder, manager);

      const paymentNumber = await this.nextPaymentNumber(manager);
      const payment = manager.create(Payment, {
        paymentNumber,
        orderId: lockedOrder.id,
        customerId: customerProfile.id,
        amountCents: owedNowCents,
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
      if (owedNowCents > 0) {
        await this.walletsService.doubleEntry(
          {
            fromWalletId: customerWallet.id,
            toWalletId: platformWallet.id,
            amountCents: owedNowCents,
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
      if (existing.paymentStatus === PaymentGatewayStatus.PROCESSING) {
        // فشل/timeout تسجيل العملية عند البوابة لا يثبت أن البوابة لم تنشئها. لا نرسل إنشاءً
        // ثانيًا بنفس المفتاح لأن ده قد يخلق تحصيلين؛ ننتظر الـ webhook أو reconciliation.
        throw new ApiException(
          ErrorCode.PAY_003,
          'نتيجة محاولة الدفع السابقة لسه قيد التحقق عند البوابة — لا تعيد الدفع الآن',
          HttpStatus.CONFLICT,
        );
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
    // المبلغ المستحق دلوقتي (ADR-0015) — راجع تعليق collectCash فوق لنفس المنطق بالحرف. صف
    // الدفعة (Payment.amountCents) هو نفسه اللي التحقق من مبلغ الـwebhook بيقارن بيه لاحقًا
    // (P0-7)، فمفيش تعديل إضافي مطلوب هناك — هيتحقق صح تلقائيًا ضد الدلتا مش الإجمالي الكامل.
    const owedNowCents = await this.amountOwedNow(order);

    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);

    const paymentNumber = await this.dataSource.transaction((manager) => this.nextPaymentNumber(manager));
    const payment = this.payments.create({
      paymentNumber,
      orderId: order.id,
      customerId: customerProfile.id,
      amountCents: owedNowCents,
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
      // انقطاع الشبكة أو timeout في إنشاء العملية لا يثبت أن البوابة لم تنشئ intention/charge.
      // PROCESSING معناها "النتيجة الخارجية غير محسومة"، فتمنع إرسال إنشاء ثانٍ حتى يصل webhook
      // موثّق أو تدخل عملية reconciliation. FAILED محجوزة لرفض/فشل تؤكده البوابة نفسها.
      payment.paymentStatus = PaymentGatewayStatus.PROCESSING;
      payment.failureCode = 'GATEWAY_REGISTRATION_OUTCOME_UNKNOWN';
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
  private async emitPaymentConfirmedEvents(info: PaymentConfirmedEffects): Promise<void> {
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

  /** Delivers only the durable post-commit stage; it never re-enters financial settlement. */
  private async deliverPaymentConfirmedEffects(webhookEvent: WebhookEvent): Promise<void> {
    const info = webhookEvent.effectsPayload as PaymentConfirmedEffects | null;
    if (webhookEvent.processingStage !== WebhookProcessingStage.EFFECTS || !info?.orderId) {
      throw new Error('webhook effects checkpoint is missing or invalid');
    }

    await this.emitPaymentConfirmedEvents(info);
    webhookEvent.effectsDeliveredAt = new Date();
    await this.markWebhookProcessed(webhookEvent);
  }

  /**
   * Claim ذري للـ webhook: الـ INSERT/UPDATE نفسه هو ضمان التزامن، وليس find ثم insert. الحدث
   * النهائي (processed/ignored) لا يُعاد فتحه، بينما received/failed فقط يمكن امتلاكهم لمحاولة
   * جديدة ضمن الحد المضبوط. هذا يسمح للـ provider retry أن يعالج فشلًا حقيقيًا بلا أثر مالي مكرر.
   */
  private async claimWebhookEvent(
    provider: string,
    eventType: string,
    externalEventId: string,
    payload: Record<string, unknown>,
    signatureValid: boolean,
    recoverStaleProcessing = false,
  ): Promise<WebhookEvent | null> {
    const maxAttempts = Math.max(
      1,
      await this.settingsService.getNumber('payments.webhook_recovery_max_attempts', WEBHOOK_RECOVERY_MAX_ATTEMPTS_FALLBACK),
    );
    const staleMinutes = Math.max(
      1,
      await this.settingsService.getNumber('payments.webhook_processing_stale_minutes', 5),
    );

    const eventId = await this.dataSource.transaction(async (manager) => {
      if (recoverStaleProcessing) {
        const exhausted = (await manager.query(
          `UPDATE webhook_events
           SET processing_status = 'manual_review',
               processing_started_at = NULL,
               next_retry_at = NULL,
               error_message = COALESCE(error_message, 'stale processing exhausted retry limit')
           WHERE provider = $1
             AND external_event_id = $2
             AND processing_status = 'processing'
             AND processing_started_at < now() - ($4 * interval '1 minute')
             AND retry_count >= $3
           RETURNING id`,
          [provider, externalEventId, maxAttempts, staleMinutes],
        )) as Array<{ id: string }>;
        if (exhausted.length > 0) return null;
      }

      const rows = (await manager.query(
        `INSERT INTO webhook_events
          (provider, event_type, external_event_id, payload, signature_valid, processing_status, retry_count, processing_started_at)
         VALUES ($1, $2, $3, $4, $5, 'processing', 1, now())
         ON CONFLICT (provider, external_event_id) DO UPDATE
           SET processing_status = 'processing',
               retry_count = webhook_events.retry_count + 1,
               processing_started_at = now(),
               next_retry_at = NULL,
               processed_at = NULL,
               error_message = NULL
         WHERE (webhook_events.processing_status = 'received'
            OR (webhook_events.processing_status = 'failed'
                AND webhook_events.next_retry_at IS NOT NULL
                AND webhook_events.next_retry_at <= now())
            OR ($7 = true
                AND webhook_events.processing_status = 'processing'
                AND webhook_events.processing_started_at < now() - ($8 * interval '1 minute')))
           AND webhook_events.retry_count < $6
         RETURNING id`,
        [provider, eventType, externalEventId, JSON.stringify(payload), signatureValid, maxAttempts, recoverStaleProcessing, staleMinutes],
      )) as Array<{ id: string }>;
      return rows[0]?.id ?? null;
    });

    if (!eventId) return null;
    return this.webhookEvents.findOne({ where: { id: eventId } });
  }

  /** Claims a persisted effects checkpoint directly; no provider payload is re-ingested. */
  private async claimWebhookEffects(webhookEventId: string): Promise<WebhookEvent | null> {
    const maxAttempts = Math.max(
      1,
      await this.settingsService.getNumber('payments.webhook_recovery_max_attempts', WEBHOOK_RECOVERY_MAX_ATTEMPTS_FALLBACK),
    );
    const staleMinutes = Math.max(
      1,
      await this.settingsService.getNumber('payments.webhook_processing_stale_minutes', 5),
    );

    const eventId = await this.dataSource.transaction(async (manager) => {
      const event = await manager
        .createQueryBuilder(WebhookEvent, 'event')
        .setLock('pessimistic_write')
        .where('event.id = :webhookEventId', { webhookEventId })
        .getOne();
      if (!event || event.processingStage !== WebhookProcessingStage.EFFECTS) return null;

      const now = new Date();
      const staleBefore = new Date(now.getTime() - staleMinutes * 60 * 1000);
      const staleProcessing =
        event.processingStatus === WebhookProcessingStatus.PROCESSING &&
        event.processingStartedAt !== null &&
        event.processingStartedAt < staleBefore;

      if (staleProcessing && event.retryCount >= maxAttempts) {
        event.processingStatus = WebhookProcessingStatus.MANUAL_REVIEW;
        event.processingStartedAt = null;
        event.nextRetryAt = null;
        event.errorMessage ||= 'stale effects delivery exhausted retry limit';
        await manager.save(event);
        return null;
      }

      const retryableFailure =
        event.processingStatus === WebhookProcessingStatus.FAILED &&
        event.nextRetryAt !== null &&
        event.nextRetryAt <= now;
      if ((!retryableFailure && !staleProcessing) || event.retryCount >= maxAttempts) return null;

      event.processingStatus = WebhookProcessingStatus.PROCESSING;
      event.retryCount += 1;
      event.processingStartedAt = now;
      event.nextRetryAt = null;
      event.processedAt = null;
      event.errorMessage = null;
      await manager.save(event);
      return event.id;
    });

    if (!eventId) return null;
    return this.webhookEvents.findOne({ where: { id: eventId } });
  }

  /** Recovery must terminalize an exhausted stale owner before provider parsing can short-circuit. */
  private async terminalizeExhaustedStaleWebhookEvent(webhookEventId: string): Promise<boolean> {
    const maxAttempts = Math.max(
      1,
      await this.settingsService.getNumber('payments.webhook_recovery_max_attempts', WEBHOOK_RECOVERY_MAX_ATTEMPTS_FALLBACK),
    );
    const staleMinutes = Math.max(
      1,
      await this.settingsService.getNumber('payments.webhook_processing_stale_minutes', 5),
    );

    return this.dataSource.transaction(async (manager) => {
      const event = await manager
        .createQueryBuilder(WebhookEvent, 'event')
        .setLock('pessimistic_write')
        .where('event.id = :webhookEventId', { webhookEventId })
        .getOne();
      if (
        !event ||
        event.processingStatus !== WebhookProcessingStatus.PROCESSING ||
        event.processingStartedAt === null ||
        event.processingStartedAt >= new Date(Date.now() - staleMinutes * 60 * 1000) ||
        event.retryCount < maxAttempts
      ) {
        return false;
      }

      event.processingStatus = WebhookProcessingStatus.MANUAL_REVIEW;
      event.processingStartedAt = null;
      event.nextRetryAt = null;
      event.errorMessage ||= 'stale processing exhausted retry limit';
      await manager.save(event);
      return true;
    });
  }

  private async markWebhookIgnored(webhookEvent: WebhookEvent, message: string): Promise<void> {
    webhookEvent.processingStatus = WebhookProcessingStatus.IGNORED;
    webhookEvent.errorMessage = message;
    webhookEvent.nextRetryAt = null;
    webhookEvent.processingStartedAt = null;
    webhookEvent.processedAt = new Date();
    await this.webhookEvents.save(webhookEvent);
  }

  private async markWebhookProcessed(webhookEvent: WebhookEvent): Promise<void> {
    webhookEvent.processingStatus = WebhookProcessingStatus.PROCESSED;
    webhookEvent.errorMessage = null;
    webhookEvent.nextRetryAt = null;
    webhookEvent.processingStartedAt = null;
    webhookEvent.processedAt = new Date();
    await this.webhookEvents.save(webhookEvent);
  }

  private async markWebhookFailed(webhookEvent: WebhookEvent, message: string, retryable = true): Promise<void> {
    const maxAttempts = Math.max(
      1,
      await this.settingsService.getNumber('payments.webhook_recovery_max_attempts', WEBHOOK_RECOVERY_MAX_ATTEMPTS_FALLBACK),
    );
    const baseDelaySeconds = Math.max(
      1,
      await this.settingsService.getNumber(
        'payments.webhook_recovery_base_delay_seconds',
        WEBHOOK_RECOVERY_BASE_DELAY_SECONDS_FALLBACK,
      ),
    );
    const canRetry = retryable && webhookEvent.retryCount < maxAttempts;
    const delaySeconds = baseDelaySeconds * 2 ** Math.max(0, webhookEvent.retryCount - 1);

    webhookEvent.processingStatus = canRetry
      ? WebhookProcessingStatus.FAILED
      : WebhookProcessingStatus.MANUAL_REVIEW;
    webhookEvent.errorMessage = message;
    webhookEvent.processingStartedAt = null;
    webhookEvent.nextRetryAt = canRetry ? new Date(Date.now() + delaySeconds * 1000) : null;
    webhookEvent.processedAt = null;
    await this.webhookEvents.save(webhookEvent);
  }

  /**
   * بيتنادى من WebhooksController بعد ما يتحقق التوقيع مسبقاً. بيسجّل الحدث في webhook_events
   * (حماية من معالجة مكررة عبر `(provider, external_event_id)` UNIQUE)، وبعدين لو نجحت العملية بيعدّي بنفس
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
    recoverStaleProcessing = false,
  ): Promise<void> {
    if (!signatureValid) {
      // حدث بتوقيع غير صحيح لا يدخل سجل الهوية نفسه؛ عدم السماح له بحجز external_event_id يمنع
      // حمولة مزوّرة تعرف رقمًا متوقعًا من تعطيل الحدث الصحيح الذي قد يصل لاحقًا.
      this.logger.warn(`webhook برد توقيع غلط اترفض: ${externalEventId}`);
      return;
    }

    const webhookEvent = await this.claimWebhookEvent(
      provider,
      eventType,
      externalEventId,
      rawPayload,
      signatureValid,
      recoverStaleProcessing,
    );
    if (!webhookEvent) {
      // processed/ignored نهائي، أو محاولة أخرى تملكت الحدث الآن. في الحالتين الـ provider يأخذ
      // 200 بلا أثر مالي ثانٍ؛ الفحص الدوري يعالج processing العالق لو انهار مالك المحاولة.
      this.logger.log(`webhook مكرر أو قيد المعالجة: ${provider}:${externalEventId}`);
      return;
    }

    if (webhookEvent.processingStage === WebhookProcessingStage.EFFECTS) {
      try {
        await this.deliverPaymentConfirmedEffects(webhookEvent);
      } catch (err) {
        await this.markWebhookFailed(webhookEvent, err instanceof Error ? err.message : String(err));
        this.logger.error(`فشل استرداد آثار webhook ${externalEventId}`, err instanceof Error ? err.stack : err);
        throw err;
      }
      return;
    }

    if (!paymentId) {
      await this.markWebhookIgnored(webhookEvent, 'مفيش payment_id في الحمولة');
      return;
    }

    const payment = await this.payments.findOne({ where: { id: paymentId } });
    if (!payment) {
      await this.markWebhookFailed(webhookEvent, `دفعة غير موجودة: ${paymentId}`);
      return;
    }

    if (payment.paymentStatus !== PaymentGatewayStatus.PENDING && payment.paymentStatus !== PaymentGatewayStatus.PROCESSING) {
      // اتعالجت قبل كده (idempotency على مستوى الدفعة نفسها، مش بس external_event_id) —
      // ممكن يحصل لو نفس البوابة بعتت حدثين بمعرّفين مختلفين لنفس العملية.
      await this.markWebhookIgnored(webhookEvent, `الدفعة already في حالة ${payment.paymentStatus}`);
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
      await this.markWebhookFailed(
        webhookEvent,
        `المبلغ في الـwebhook (${webhookAmountCents}) مايطابقش المبلغ المتوقع (${payment.amountCents}) — الحدث اترفض بأمان`,
        false,
      );
      this.logger.error(
        `webhook برد مبلغ غير متطابق اترفض: ${externalEventId} — دفعة ${paymentId} متوقّع ${payment.amountCents} ووصل ${webhookAmountCents}`,
      );
      return;
    }

    try {
      if (payment.orderItemBatchId) {
        // تأكيد دفع شغل إضافي (docs/08 §21) — الطلب لسه شغال (مش بيقفل هنا)، فمايستدعيش
        // assertPayable()/handlePaymentConfirmed() خالص (كانوا هيرفضوا بوضوح لطلب IN_PROGRESS).
        // نفس حماية دفعة الطلب الأصلية فوق (dedup، توقيع، مطابقة مبلغ) سرت عليه بالفعل قبل السطر ده.
        await this.finalizeAdditionalWorkPayment(payment, succeeded, gatewayTransactionId, failureReason);
      } else if (succeeded) {
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
          const effects: PaymentConfirmedEffects = {
            dispatchStarted,
            orderId: lockedOrder.id,
            orderNumber: lockedOrder.orderNumber,
            customerId: lockedOrder.customerId,
            technicianId: lockedOrder.technicianId,
            serviceId: lockedOrder.serviceId,
          };
          await manager.query(
            `UPDATE webhook_events
             SET processing_stage = $2, effects_payload = $3::jsonb, effects_delivered_at = NULL
             WHERE id = $1`,
            [webhookEvent.id, WebhookProcessingStage.EFFECTS, JSON.stringify(effects)],
          );
          return effects;
        });

        webhookEvent.processingStage = WebhookProcessingStage.EFFECTS;
        webhookEvent.effectsPayload = dispatchInfo;
        webhookEvent.effectsDeliveredAt = null;
        await this.deliverPaymentConfirmedEffects(webhookEvent);
        return;
      } else {
        payment.gatewayTransactionId = gatewayTransactionId;
        payment.paymentStatus = PaymentGatewayStatus.FAILED;
        payment.failureCode = 'GATEWAY_DECLINED';
        payment.failureMessage = failureReason;
        payment.failedAt = new Date();
        await this.payments.save(payment);
        // مفيش تغيير في حالة الطلب — العميل يقدر يعيد المحاولة (بطاقة تانية، محفظة، كاش)
      }

      await this.markWebhookProcessed(webhookEvent);
    } catch (err) {
      await this.markWebhookFailed(webhookEvent, err instanceof Error ? err.message : String(err));
      this.logger.error(`فشل معالجة webhook ${externalEventId}`, err instanceof Error ? err.stack : err);
      throw err;
    }
  }

  /**
   * حدث "حفظ كارت" من البوابة (docs/08 §21) — حمولة/معنى مختلف تمامًا عن finalizeGatewayWebhook()
   * (مفيش payment.id نربط بيه، الربط بحساب العميل عندنا عبر الإيميل). idempotent بنفس آلية
   * webhook_events.external_event_id، وupsertToken() نفسها idempotent كمان (provider+token unique).
   */
  async finalizeCardSaveWebhook(
    externalEventId: string,
    provider: string,
    rawPayload: Record<string, unknown>,
    signatureValid: boolean,
    providerToken: string,
    maskedPan: string | null,
    cardBrand: string | null,
    customerEmail: string | null,
    recoverStaleProcessing = false,
  ): Promise<void> {
    if (!signatureValid) {
      this.logger.warn(`webhook حفظ كارت بتوقيع غير صحيح اترفض: ${externalEventId}`);
      return;
    }

    const webhookEvent = await this.claimWebhookEvent(
      provider,
      'TOKEN',
      externalEventId,
      rawPayload,
      signatureValid,
      recoverStaleProcessing,
    );
    if (!webhookEvent) {
      this.logger.log(`webhook حفظ كارت مكرر أو قيد المعالجة: ${provider}:${externalEventId}`);
      return;
    }

    if (!customerEmail) {
      await this.markWebhookIgnored(webhookEvent, 'مفيش إيميل عميل في حدث حفظ الكارت');
      return;
    }

    const user = await this.users.findOne({ where: { email: customerEmail } });
    if (!user) {
      await this.markWebhookIgnored(webhookEvent, `مفيش مستخدم عندنا بالإيميل ${customerEmail}`);
      return;
    }

    try {
      const customerProfile = await this.customerProfiles.findByUserIdOrThrow(user.id);
      await this.savedPaymentMethods.upsertToken({
        customerId: customerProfile.id,
        provider,
        providerToken,
        cardBrand,
        maskedPan,
      });
      await this.markWebhookProcessed(webhookEvent);
    } catch (err) {
      // فشل قاعدة البيانات/التوكن قابل للاسترداد؛ لا نحوله لـ ignored لمجرد أن المحاولة الأولى
      // فشلت، لأن مزوّد الدفع لن يرسل أثرًا ماليًا ثانيًا عند إعادة معالجة نفس حدث الحفظ.
      await this.markWebhookFailed(webhookEvent, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  /**
   * يعيد تشغيل حدث محفوظ بعد فشل/انقطاع process. التحقق من التوقيع يُعاد من الحمولة المحفوظة
   * نفسها؛ صف قديم لا يحمل توقيع Paymob لا يُخمّن له توقيع ولا يُعاد تشغيله تلقائيًا، ويظل
   * ظاهرًا للمراجعة التشغيلية بدل تنفيذ قرار مالي على بيانات غير مكتملة.
   */
  async recoverWebhookEvent(webhookEventId: string): Promise<void> {
    const event = await this.webhookEvents.findOne({ where: { id: webhookEventId } });
    if (!event) return;
    if (await this.terminalizeExhaustedStaleWebhookEvent(event.id)) return;
    if (!event.signatureValid) return;

    // Financial truth was already committed with this checkpoint. Claim and replay only the
    // durable effects payload; provider parsing and settlement must not run a second time.
    if (event.processingStage === WebhookProcessingStage.EFFECTS) {
      const claimed = await this.claimWebhookEffects(event.id);
      if (!claimed) return;
      try {
        await this.deliverPaymentConfirmedEffects(claimed);
      } catch (err) {
        await this.markWebhookFailed(claimed, err instanceof Error ? err.message : String(err));
        throw err;
      }
      return;
    }

    const { __baytak_delivery_hmac: persistedHmac, ...rawPayload } = event.payload as Record<string, unknown>;
    const hmac = typeof persistedHmac === 'string' ? persistedHmac : undefined;
    const provider = this.paymentProviders.getByProviderKey(event.provider);

    if (event.provider === 'paymob' && !hmac) {
      this.logger.warn(`webhook قديم بلا توقيع محفوظ يحتاج مراجعة يدوية: ${event.provider}:${event.externalEventId}`);
      return;
    }

    if (event.eventType === 'TOKEN') {
      const parsed = provider.verifyCardSaveWebhook(rawPayload, hmac);
      if (!parsed?.signatureValid) {
        this.logger.warn(`تعذر إعادة التحقق من webhook حفظ الكارت: ${event.provider}:${event.externalEventId}`);
        return;
      }
      await this.finalizeCardSaveWebhook(
        parsed.externalEventId,
        event.provider,
        event.payload,
        parsed.signatureValid,
        parsed.providerToken,
        parsed.maskedPan,
        parsed.cardBrand,
        parsed.customerEmail,
        true,
      );
      return;
    }

    const parsed = provider.verifyWebhook(rawPayload, hmac);
    if (!parsed.signatureValid) {
      this.logger.warn(`تعذر إعادة التحقق من webhook دفع: ${event.provider}:${event.externalEventId}`);
      return;
    }
    await this.finalizeGatewayWebhook(
      parsed.externalEventId,
      parsed.eventType,
      event.provider,
      event.payload,
      parsed.signatureValid,
      parsed.paymentId,
      parsed.succeeded,
      parsed.failureReason,
      parsed.gatewayTransactionId,
      event.provider === 'fawry' ? PaymentMethod.FAWRY_REFERENCE : PaymentMethod.CARD,
      parsed.amountCents,
      true,
    );
  }

  /**
   * تأكيد نتيجة تحصيل شغل إضافي (docs/08 §21) — الطلب لسه شغال (مايستدعيش settleAndComplete/
   * handlePaymentConfirmed خالص، عكس دفعة الطلب الأصلية). بس تحديث حالة الدفعة + بث حدث بسيط
   * للإشعار. `succeeded` هنا فعلاً مصدر الحقيقة النهائي (§13) — أول مرة الدفعة تتسجّل SUCCEEDED
   * فعليًا، مش وقت attemptAdditionalWorkCharge() (اللي بتسجّلها processing بس).
   */
  private async finalizeAdditionalWorkPayment(
    payment: Payment,
    succeeded: boolean,
    gatewayTransactionId: string,
    failureReason: string | null,
  ): Promise<void> {
    payment.gatewayTransactionId = gatewayTransactionId;
    if (succeeded) {
      payment.paymentStatus = PaymentGatewayStatus.SUCCEEDED;
      payment.completedAt = new Date();
    } else {
      payment.paymentStatus = PaymentGatewayStatus.FAILED;
      payment.failureCode = 'GATEWAY_DECLINED';
      payment.failureMessage = failureReason;
      payment.failedAt = new Date();
    }
    await this.payments.save(payment);

    this.events.emit(
      ADDITIONAL_WORK_PAYMENT_RESOLVED_EVENT,
      new AdditionalWorkPaymentResolvedEvent(payment.id, payment.orderId, '', payment.amountCents, payment.customerId, succeeded),
    );
  }

  /**
   * تحصيل فوري لشغل إضافي معتمد إلكترونيًا (docs/08 §21) — بتتنادى من OrderItemsService.approve()
   * فور ما العميل يوافق، لو الطلب مدفوع مسبقًا. **الشغل يكمل بغض النظر عن نتيجة المحاولة دي** —
   * لو مفيش وسيلة دفع محفوظة أو المحاولة فشلت، المبلغ يفضل obligation مسجّل (Payment=failed)،
   * هيتحصّل عبر amountOwedNow()/AWAITING_PAYMENT الموجودة وقت اكتمال الشغل زي أي دلتا تانية
   * (ADR-0015) — صفر فقدان للمبلغ المستحق مهما كانت نتيجة المحاولة الفورية.
   */
  async attemptAdditionalWorkCharge(orderId: string, batchId: string, amountCents: number): Promise<void> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) return; // دفاعي — مستحيل عمليًا (الكولر لسه ماسك نفس الطلب)

    const customerProfile = await this.customerProfiles.findByProfileIdOrThrow(order.customerId);
    const user = await this.users.findOne({ where: { id: customerProfile.userId } });
    if (!user) return; // دفاعي بحت

    const paymentNumber = await this.dataSource.transaction((manager) => this.nextPaymentNumber(manager));
    const payment = this.payments.create({
      paymentNumber,
      orderId: order.id,
      customerId: customerProfile.id,
      amountCents,
      paymentMethod: PaymentMethod.CARD,
      paymentGateway: 'paymob',
      paymentStatus: PaymentGatewayStatus.PENDING,
      // idempotency على مستوى الدفعة نفسها — batchId فريد لكل موافقة (§12: "one approved price
      // request must create exactly one financial obligation"). unique constraint على العمود ده
      // بيمنع أي محاولة إنشاء صف تاني لنفس الدفعة حتى لو attemptAdditionalWorkCharge() اتنادت مرتين بالغلط.
      idempotencyKey: `addl-work:${batchId}`,
      orderItemBatchId: batchId,
    });
    await this.payments.save(payment);

    const savedMethod = await this.savedPaymentMethods.findDefaultForCustomer(customerProfile.id);
    if (!savedMethod) {
      // §18 — مفيش وسيلة دفع محفوظة، مفيش نداء بوابة أصلاً. المبلغ يفضل obligation واضح (failed)
      // بدل ما يختفي أو يتحصّل غلط.
      payment.paymentStatus = PaymentGatewayStatus.FAILED;
      payment.failureCode = 'NO_SAVED_PAYMENT_METHOD';
      payment.failureMessage = 'مفيش وسيلة دفع محفوظة للعميل';
      payment.failedAt = new Date();
      await this.payments.save(payment);
      return;
    }

    const provider = this.paymentProviders.getByProviderKey(savedMethod.provider);
    if (!provider.supportsTokenization) {
      payment.paymentStatus = PaymentGatewayStatus.FAILED;
      payment.failureCode = 'TOKENIZATION_NOT_SUPPORTED';
      payment.failureMessage = `${savedMethod.provider} مش بيدعم التحصيل التلقائي بوسيلة محفوظة`;
      payment.failedAt = new Date();
      await this.payments.save(payment);
      return;
    }

    const [firstName, ...rest] = user.fullName.trim().split(/\s+/);
    try {
      const result = await provider.chargeToken({
        paymentId: payment.id,
        orderNumber: order.orderNumber,
        amountCents,
        currencyCode: 'EGP',
        providerToken: savedMethod.providerToken,
        customerFirstName: firstName || 'NA',
        customerLastName: rest.join(' ') || 'NA',
        customerEmail: user.email ?? `customer-${user.id}@baytak.app`,
        customerPhone: user.phoneNumber,
      });
      if (result.succeeded) {
        // بتفضل PENDING عمداً (مش PROCESSING) — نفس اتفاقية payWithCard/initiateProviderCharge
        // بالحرف: PENDING يعني "البوابة قبلت النداء، مستنية تأكيد webhook نهائي" (§13)، وده الشرط
        // اللي finalizeGatewayWebhook() بيفحصه (`paymentStatus !== PENDING` = already-processed
        // idempotency guard) — استخدام PROCESSING هنا كان هيخلي أي webhook تأكيد يتجاهل بالغلط
        // كـ"already processed" قبل ما يوصل لمنطق finalizeAdditionalWorkPayment() أصلاً.
        if (result.providerReference) payment.gatewayTransactionId = result.providerReference;
      } else {
        payment.paymentStatus = PaymentGatewayStatus.FAILED;
        payment.failureCode = 'GATEWAY_DECLINED';
        payment.failureMessage = result.failureReason;
        payment.failedAt = new Date();
      }
    } catch (err) {
      payment.paymentStatus = PaymentGatewayStatus.FAILED;
      payment.failureCode = 'GATEWAY_CALL_FAILED';
      payment.failureMessage = err instanceof Error ? err.message : String(err);
      payment.failedAt = new Date();
    }
    await this.payments.save(payment);
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
   * الملخص المالي لطلب واحد (docs/08 §20 بند 11) — كانت فجوة عرض حقيقية: `platform_commission_cents`/
   * `technician_earning_cents` محسوبين ومخزّنين على الطلب من زمان (docs/08 §20 بند 1) بس مش معروضين
   * لأي أدمن، ومفيش أي endpoint يرجّع وسيلة الدفع أو تاريخ الاسترداد لطلب معيّن — أدمن عايز يفهم
   * "الطلب ده فلوسه راحت فين" كان لازم يفتح `/admin/wallets/:userId` منفصلة (لو عارف مين الفني)
   * ويدوّر يدوي. الدالة دي بتلمّ اللي موجود بالفعل بس، صفر حساب جديد أو جدول جديد — نفس مبدأ §20's
   * الحاكم ("لو الداتا موجودة، اربطها/اعرضها بس").
   */
  async getFinancialSummaryForOrder(orderId: string): Promise<{
    platformCommissionCents: number;
    technicianEarningCents: number;
    cancellationFeeCents: number;
    payments: Pick<
      Payment,
      'id' | 'paymentMethod' | 'paymentStatus' | 'amountCents' | 'completedAt' | 'orderItemBatchId' | 'failureCode' | 'failureMessage'
    >[];
    refunds: Pick<Refund, 'id' | 'amountCents' | 'refundType' | 'refundMethod' | 'refundStatus' | 'completedAt'>[];
  }> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
    }
    const [payments, refunds] = await Promise.all([
      this.payments.find({ where: { orderId }, order: { initiatedAt: 'ASC' } }),
      this.refunds.find({ where: { orderId }, order: { requestedAt: 'ASC' } }),
    ]);
    return {
      platformCommissionCents: order.platformCommissionCents,
      technicianEarningCents: order.technicianEarningCents,
      cancellationFeeCents: order.cancellationFeeCents,
      payments,
      refunds,
    };
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
    paymentId?: string,
  ): Promise<Refund> {
    // بَقّة distributed-transaction حقيقية اتصلحت (docs/08 §19 بند 4): كان provider.refund()
    // (نداء HTTP خارجي حقيقي لـPaymob) بينفّذ جوّه DB transaction واحدة مع باقي الكتابة. لو
    // نجح فعليًا عند البوابة وبعدين خطوة تانية جوّه نفس الـtransaction فشلت (DB error عابر
    // مثلاً)، Postgres يعمل rollback كامل — لكن الفلوس فعليًا اترجعت للعميل عند Paymob، ونظامنا
    // مش عارف. الحل: تقسيم لتلات مراحل — (أ) DB transaction قصيرة بتسجّل صف Refund حالته
    // PROCESSING **قبل** أي نداء خارجي أو أثر مالي. كل محاولة بتحجز المبلغ المتبقي للدفعـة داخل
    // قفل الطلب؛ ده يسمح باستردادات جزئية متراكمة، وفي نفس الوقت يمنع تجاوز إجمالي الدفعة أو
    // نداءين متزامنين لنفس الجزء المالي. (ب) النداء الخارجي نفسه **برّه** أي transaction، (ج)
    // DB transaction قصيرة تانية منفصلة تمامًا تطبّق أثر المال ثم تسجّل COMPLETED. حتى مسار
    // wallet-credit بلا بوابة يظل PROCESSING بين (أ) و(ج): crash في المنتصف يصبح قابلًا
    // للمراجعة، لا استردادًا مكتملًا كذبًا.
    const prepared = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();
      if (!order) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
      }
      if (order.paymentStatus !== OrderPaymentStatus.PAID && order.paymentStatus !== OrderPaymentStatus.PARTIALLY_REFUNDED) {
        throw new ApiException(ErrorCode.PAY_003, 'الطلب لازم يكون مدفوع الأول عشان يترد', HttpStatus.CONFLICT);
      }

      const refundablePayments = await manager.find(Payment, {
        where: {
          orderId,
          paymentStatus: In([PaymentGatewayStatus.SUCCEEDED, PaymentGatewayStatus.PARTIALLY_REFUNDED]),
        },
        order: { completedAt: 'DESC' },
      });
      const payment = paymentId
        ? refundablePayments.find((candidate) => candidate.id === paymentId)
        : refundablePayments.length === 1
          ? refundablePayments[0]
          : null;
      if (!payment) {
        if (!paymentId && refundablePayments.length > 1) {
          throw new ApiException(
            ErrorCode.PAY_003,
            'الطلب فيه أكثر من دفعة قابلة للاسترداد — ابعت payment_id لتحديد الدفعة المقصودة',
            HttpStatus.CONFLICT,
          );
        }
        throw new ApiException(
          ErrorCode.VAL_001,
          paymentId ? 'الدفعة المحددة غير قابلة للاسترداد لهذا الطلب' : 'مفيش عملية دفع قابلة للاسترداد للطلب ده',
          HttpStatus.NOT_FOUND,
        );
      }

      // PROCESSING يحجز المبلغ أيضًا: لا يمكن إنشاء refund جديد بينما نتيجة نداء سابق للبوابة
      // غير مؤكدة، وإلا صار ممكنًا إرسال مبلغ زائد أو استرداد مزدوج خارجيًا.
      const refundsForPayment = await manager.find(Refund, {
        where: { paymentId: payment.id },
        select: ['amountCents', 'refundStatus'],
      });
      if (refundsForPayment.some((candidate) => candidate.refundStatus === RefundStatus.PROCESSING)) {
        throw new ApiException(
          ErrorCode.PAY_003,
          'محاولة استرداد سابقة لسه قيد التأكيد مع البوابة — راجع الطلب يدويًا (provider.reconcile) قبل إعادة المحاولة',
          HttpStatus.CONFLICT,
        );
      }
      const reservedAmountCents = refundsForPayment
        .filter((candidate) => candidate.refundStatus === RefundStatus.COMPLETED || candidate.refundStatus === RefundStatus.PROCESSING)
        .reduce((total, candidate) => total + candidate.amountCents, 0);
      const remainingAmountCents = payment.amountCents - reservedAmountCents;
      if (remainingAmountCents <= 0) {
        throw new ApiException(
          ErrorCode.PAY_003,
          'لا يوجد مبلغ متبقٍ قابل للاسترداد لهذه الدفعة — راجع أي استرداد قيد التأكيد أولًا',
          HttpStatus.CONFLICT,
        );
      }

      const amountCents = requestedAmountCents ?? remainingAmountCents;
      if (amountCents <= 0 || amountCents > remainingAmountCents) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'مبلغ الاسترداد غير صالح — لازم يكون بين 1 والمبلغ المتبقي من الدفعة',
          HttpStatus.BAD_REQUEST,
        );
      }
      const clearsRemainingPayment = amountCents === remainingAmountCents;
      // RefundType describes this row, not the cumulative payment result. A 20,000 row after an
      // earlier 10,000 refund is still PARTIAL for an original 30,000 payment.
      const refundRowIsFull = amountCents === payment.amountCents;

      // "كامل" هنا يعني كامل *الدفعـة*، وليس بالضرورة كامل الطلب. الطلب قد يتكوّن من
      // دفعة الخدمة الأساسية ودفعة/دفعات عمل إضافي منفصلة. لا نغلقه REFUNDED قبل اكتمال
      // استرداد كل المكوّنات المالية فعليًا.
      const financialPayments = await manager.find(Payment, {
        where: {
          orderId,
          paymentStatus: In([
            PaymentGatewayStatus.SUCCEEDED,
            PaymentGatewayStatus.PARTIALLY_REFUNDED,
            PaymentGatewayStatus.REFUNDED,
          ]),
        },
        select: ['id', 'amountCents'],
      });
      const completedRefunds = await manager.find(Refund, {
        where: { orderId, refundStatus: RefundStatus.COMPLETED },
        select: ['paymentId', 'amountCents'],
      });
      const completedByPayment = new Map<string, number>();
      for (const completedRefund of completedRefunds) {
        completedByPayment.set(
          completedRefund.paymentId,
          (completedByPayment.get(completedRefund.paymentId) ?? 0) + completedRefund.amountCents,
        );
      }
      const willFullyRefundOrder = financialPayments.length > 0 && financialPayments.every((financialPayment) => {
        const alreadyCompleted = completedByPayment.get(financialPayment.id) ?? 0;
        const currentAmount = financialPayment.id === payment.id ? amountCents : 0;
        return alreadyCompleted + currentAmount >= financialPayment.amountCents;
      });

      // استرداد كل مكوّنات الطلب فقط هو اللي بيغيّر حالته لـREFUNDED (نهائية) — لازم يمر
      // بـcanTransition. استرداد دفعة واحدة من طلب مركّب يظل جزئيًا على مستوى الطلب.
      if (willFullyRefundOrder && !canTransition(order.orderStatus, OrderStatus.REFUNDED)) {
        throw new ApiException(ErrorCode.ORDR_003, 'انتقال حالة غير مسموح', HttpStatus.CONFLICT);
      }
      if (!willFullyRefundOrder && order.orderStatus !== OrderStatus.COMPLETED && order.orderStatus !== OrderStatus.DISPUTED) {
        throw new ApiException(ErrorCode.ORDR_003, 'الطلب لازم يكون مكتمل أو متنازع عليه عشان يترد جزئيًا', HttpStatus.CONFLICT);
      }

      const provider = this.paymentProviders.getProvider(payment.paymentMethod);
      const goesThroughGateway = provider.supportsRefund && !!payment.gatewayTransactionId;

      const refundNumber = await this.nextRefundNumber(manager);
      const refund = manager.create(Refund, {
        refundNumber,
        paymentId: payment.id,
        orderId: order.id,
        amountCents,
        refundType: refundRowIsFull ? RefundType.FULL : RefundType.PARTIAL,
        reasonNotes,
        // مفيش استرداد حقيقي مدعوم لطريقة الدفع دي (كاش/محفظة/InstaPay/فوري) — نفس الإصلاح
        // الصادق من قبل: wallet credit فعلي بدل رقم "مكتمل" كاذب من غير حركة فلوس. يظل الصف
        // PROCESSING حتى القيد المزدوج في المرحلة (ج) ينجح داخل transaction واحدة معه.
        refundMethod: goesThroughGateway ? RefundMethod.ORIGINAL_METHOD : RefundMethod.WALLET_CREDIT,
        refundStatus: RefundStatus.PROCESSING,
        requestedByUserId: performedByUserId,
        approvedByUserId: performedByUserId,
        requestedAt: new Date(),
        approvedAt: new Date(),
        completedAt: null,
        providerRefundId: null,
      });
      await manager.save(refund);

      return { order, payment, clearsRemainingPayment, amountCents, goesThroughGateway, provider, refund };
    });

    const { payment, clearsRemainingPayment, amountCents, goesThroughGateway, provider, refund } = prepared;

    // المرحلة (ب) — برّه أي DB transaction تمامًا. صف الـrefund اتسجّل بالفعل PROCESSING فوق
    // قبل النداء ده، فحتى لو الـprocess وقع دلوقتي بعد نجاح فعلي عند البوابة، فحص existingRefund
    // فوق هيمنع أي محاولة استرداد تانية لنفس الدفعة (مفيش استرداد مزدوج ممكن يحصل) — بس الصف
    // هيفضل PROCESSING محتاج مراجعة يدوية (provider.reconcile()) لقفله، موثّق كفجوة تشغيلية
    // معروفة مش حل تلقائي كامل (خارج نطاق هذا الإصلاح، نفس تعليق reconcile() في الـinterface).
    let providerSucceeded = true;
    let providerRefundId: string | null = null;
    if (goesThroughGateway) {
      const providerResult = await provider.refund({
        providerReference: payment.gatewayTransactionId!,
        amountCents,
        reasonAr: reasonNotes,
      });
      providerSucceeded = providerResult.succeeded;
      providerRefundId = providerResult.succeeded ? providerResult.providerRefundId : null;
    }

    // المرحلة (ج) — DB transaction قصيرة منفصلة، بعد ما نتيجة البوابة بقت معروفة فعليًا.
    const finalRefund = await this.dataSource.transaction(async (manager) => {
      // Different payments of one order can finish their external calls concurrently. Serialize
      // the durable aggregation here, then reread every row used for status and ledger decisions.
      const lockedOrder = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOneOrFail();
      const lockedRefund = await manager
        .createQueryBuilder(Refund, 'r')
        .setLock('pessimistic_write')
        .where('r.id = :refundId', { refundId: refund.id })
        .getOneOrFail();
      const lockedPayment = await manager
        .createQueryBuilder(Payment, 'p')
        .setLock('pessimistic_write')
        .where('p.id = :paymentId', { paymentId: payment.id })
        .getOneOrFail();

      if (goesThroughGateway && !providerSucceeded) {
        // رد نهائي من البوابة نفسها (رفض صريح، مش خطأ شبكة) — قرار نهائي حسب تبسيط Phase 1،
        // بيتسجّل rejected بلا أي حركة فلوس (مفيش استرداد حقيقي حصل، فمفيش داعي لعكس أي شيء).
        lockedRefund.refundStatus = RefundStatus.REJECTED;
        await manager.save(lockedRefund);
        return lockedRefund;
      }

      // عكس أرباح الفني يُوزَّع على إجمالي الطلب، لا على الدفعـة المحددة: دفعة العمل الإضافي
      // قد تكون أصغر من قيمة الطلب، والقسمة على payment.amountCents كانت تعكس أرباح الطلب كله
      // عند استرداد تلك الدفعة وحدها.
      const technicianReversalCents = Math.round(
        (lockedOrder.technicianEarningCents * amountCents) / lockedOrder.totalAmountCents,
      );
      if (technicianReversalCents > 0 && lockedOrder.technicianId) {
        const technicianProfile = await this.techniciansService.findByProfileIdOrThrow(lockedOrder.technicianId);
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
            referenceId: lockedRefund.id,
            descriptionAr: `استرجاع أرباح طلب ${lockedOrder.orderNumber}`,
            allowNegativeBalance: true, // ممكن الفني يكون صرف الفلوس دي بالفعل — الدين ده هيتسوّى في الصرف الجاي
          },
          manager,
        );
      }

      // wallet credit فعلي للعميل بس لو مفيش استرداد حقيقي حصل عند البوابة (WALLET_CREDIT fallback).
      // لو استرداد حقيقي نجح عند البوابة (ORIGINAL_METHOD)، العميل بياخد فلوسه فعليًا في كارته/محفظته
      // الخارجية مباشرة من البوابة — credit تاني هنا هيبقى استرداد مزدوج (بَقّة مالية، مش سلوك مقصود).
      if (lockedRefund.refundMethod === RefundMethod.WALLET_CREDIT) {
        const customerProfile = await this.customerProfiles.findByProfileIdOrThrow(lockedOrder.customerId);
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
            referenceId: lockedRefund.id,
            descriptionAr: `استرجاع طلب ${lockedOrder.orderNumber}`,
            allowNegativeBalance: true,
          },
          manager,
        );
      }

      // لا نعلن اكتمال الاسترداد إلا بعد نجاح كل أثر مالي محلي في نفس الـtransaction. أي استثناء
      // قبل هذا السطر يرجع transaction بالكامل ويترك صف PROCESSING الأصلي للمراجعة/reconciliation.
      lockedRefund.refundStatus = RefundStatus.COMPLETED;
      lockedRefund.providerRefundId = goesThroughGateway ? providerRefundId : null;
      lockedRefund.completedAt = new Date();
      await manager.save(lockedRefund);

      lockedPayment.paymentStatus = clearsRemainingPayment
        ? PaymentGatewayStatus.REFUNDED
        : PaymentGatewayStatus.PARTIALLY_REFUNDED;
      await manager.save(lockedPayment);

      const financialPayments = await manager.find(Payment, {
        where: {
          orderId: lockedOrder.id,
          paymentStatus: In([
            PaymentGatewayStatus.SUCCEEDED,
            PaymentGatewayStatus.PARTIALLY_REFUNDED,
            PaymentGatewayStatus.REFUNDED,
          ]),
        },
        select: ['id', 'amountCents'],
      });
      const completedRefunds = await manager.find(Refund, {
        where: { orderId: lockedOrder.id, refundStatus: RefundStatus.COMPLETED },
        select: ['paymentId', 'amountCents'],
      });
      const completedByPayment = new Map<string, number>();
      for (const completedRefund of completedRefunds) {
        completedByPayment.set(
          completedRefund.paymentId,
          (completedByPayment.get(completedRefund.paymentId) ?? 0) + completedRefund.amountCents,
        );
      }
      const orderFullyRefunded =
        financialPayments.length > 0 &&
        financialPayments.every(
          (financialPayment) => (completedByPayment.get(financialPayment.id) ?? 0) >= financialPayment.amountCents,
        );

      if (orderFullyRefunded) {
        if (lockedOrder.orderStatus !== OrderStatus.REFUNDED) {
          const previousStatus = lockedOrder.orderStatus;
          lockedOrder.orderStatus = OrderStatus.REFUNDED;
          lockedOrder.paymentStatus = OrderPaymentStatus.REFUNDED;
          await manager.save(lockedOrder);
          await manager.save(
            manager.create(OrderStatusHistory, {
              orderId: lockedOrder.id,
              previousStatus,
              newStatus: OrderStatus.REFUNDED,
              changedByUserId: performedByUserId,
              changedByRole: 'admin',
              changeSource: OrderChangeSource.ADMIN,
              reason: reasonNotes,
            }),
          );
        }
      } else {
        // استرداد جزئي — الطلب يفضل زي ما هو (COMPLETED/DISPUTED)، بس paymentStatus بيتحدّث
        // عشان يبان في تاريخ الطلب إن جزء اترد.
        lockedOrder.paymentStatus = OrderPaymentStatus.PARTIALLY_REFUNDED;
        await manager.save(lockedOrder);
      }

      return lockedRefund;
    });

    await this.auditLog.record({
      actorUserId: performedByUserId,
      actorRole: 'admin',
      action: finalRefund.refundStatus === RefundStatus.REJECTED ? 'order.refund_rejected' : 'order.refunded',
      entityType: 'order',
      entityId: orderId,
      newValues: {
        refund_id: finalRefund.id,
        amount_cents: finalRefund.amountCents,
        refund_type: finalRefund.refundType,
        refund_method: finalRefund.refundMethod,
        refund_status: finalRefund.refundStatus,
        provider_refund_id: finalRefund.providerRefundId,
        reason_notes: reasonNotes,
      },
      meta,
    });
    return finalRefund;
  }

  /**
   * استرداد فوري لطلب اتلغى (نظاميًا أو من العميل نفسه) قبل ما أي تسوية أرباح فني تحصل (docs/08
   * §19 بند 3+5، وسّعت في §20.7 لتغطي إلغاء العميل نفسه). بتتنادى من مكانين: `OrderAutoCancelService`
   * لما SEARCHING_TECHNICIAN مدفوعة مسبقًا (كارت/InstaPay، ADR-0013 "PAY BEFORE DISPATCH") تتلغى
   * تلقائيًا لعدم توفر فني خلال المهلة، أو `OrdersService.cancel()` لما العميل نفسه يلغي طلب
   * مدفوع مسبقًا من أي حالة في `CUSTOMER_CANCELLABLE_STATUSES` (قبل/بعد تعيين فني — المهم إن
   * الشغل الفعلي (`IN_PROGRESS`) لسه ما بدأش).
   *
   * **بَقّة حقيقية اتلقطت في §20.7**: قبل الإصلاح ده، الدالة دي كانت مقفولة على
   * `CANCELLED_BY_SYSTEM` بس — يعني عميل لغى بنفسه طلب مدفوع إلكترونيًا (كارت/InstaPay) قبل ما فني
   * يتعيّن (أو بعد ما يتعيّن، قبل ما الشغل يبدأ) كانت فلوسه تفضل معلّقة (`paymentStatus=PAID` على
   * طلب `CANCELLED_BY_CUSTOMER` نهائي) لحد ما أدمن يلاحظ ويرد يدويًا عبر `refundOrder()` — رغم إن
   * نفس السيناريو المالي بالظبط (طلب مدفوع، اتلغى قبل أي تسوية فني، محتاج استرداد كامل) كان بيتصرف
   * صح تلقائيًا لو النظام هو اللي لغى (timeout). الاتساق هنا مش سياسة جديدة مخترعة — نفس المبدأ
   * الموجود بالفعل ("طلب مدفوع اتلغى بلا خدمة فعلية = فلوسه ترجع تلقائيًا") بيتطبّق على مين لغى،
   * مش بس ليه.
   *
   * **مختلف عمدًا عن `refundOrder()`**: هناك الطلب لازم يكون COMPLETED/DISPUTED عشان ينتقل لحالة
   * REFUNDED نهائية (استرداد بعد خدمة اتقدّمت فعلاً أو نزاع). هنا الطلب **بالفعل** بقى
   * CANCELLED_BY_SYSTEM/CANCELLED_BY_CUSTOMER — دي الحالة النهائية الصح اللي تحكي قصته الحقيقية
   * (اتلغى، مش اتسلّم واترجعت فلوسه)، فمفيش انتقال orderStatus تاني مطلوب أو مسموح بيه
   * (`ORDER_TRANSITIONS` مفيهاش أي منهم → REFUNDED عمدًا) — بس `paymentStatus` لازم يتسجّل
   * REFUNDED عشان يبان فعليًا إن الفلوس رجعت. **مفيش عكس أرباح فني هنا مهما كانت الحالة**: تسوية
   * أرباح الفني (`settleAndComplete()`) بتحصل بس عند `WORK_COMPLETED` (`PrepaidOrderSettlementListener`)،
   * وده مستحيل يكون حصل قبل ما الطلب يوصل لأي حالة من `CUSTOMER_CANCELLABLE_STATUSES` أصلاً —
   * فصفر قيد محفظة فني يحتاج عكس، بغض النظر عن هل فني كان متعيّن وقت الإلغاء ولا لأ. رسوم الإلغاء
   * (لو السبب المُختار `chargesFee`) قيد مستقل تمامًا بيتحصّل من محفظة العميل الداخلية جوّه
   * `OrdersService.cancel()` نفسها — الدالة دي مسؤولة بس عن استرداد المبلغ المدفوع فعليًا للبوابة.
   *
   * نفس نمط أمان الـ3 مراحل بتاع `refundOrder()` بالظبط (صف Refund PROCESSING قبل أي نداء خارجي،
   * النداء نفسه برّه أي transaction، تسجيل النتيجة في transaction منفصلة) — نفس السبب: نداء
   * `provider.refund()` نداء HTTP خارجي حقيقي مايصحش يكون جوّه DB transaction ممكن ترجع لورا.
   *
   * **Idempotent عمدًا**: بترجع `null` بهدوء (بلا استثناء) لو مفيش دفعة ناجحة أو لو فيه Refund
   * مسجّل بالفعل لنفس الدفعة — الفحص الدوري ممكن يعيد استدعاء نفس الطلب أكتر من مرة (نظريًا) لو
   * `sweep()` اتأخر عليه بسبب مشكلة عابرة، فمفيش داعي يفشل بـexception يوقف بقية الدفعة. نفس
   * المنطق بيحمي إلغاء العميل من استرداد مزدوج لو `cancel()` اتنادى مرتين بالخطأ (idempotency-key
   * مستوى الـHTTP request مش موجودة هنا، بس `idx_refunds_payment_id_unique` بيمنع صف Refund تاني
   * فعليًا لنفس الدفعة).
   */
  async refundCancelledPrepaidOrder(
    orderId: string,
    reasonNotes: string,
    triggeredBy: 'system_auto_cancel' | 'customer_cancel' = 'system_auto_cancel',
  ): Promise<Refund | null> {
    const prepared = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();
      const isTerminallyCancelled =
        order?.orderStatus === OrderStatus.CANCELLED_BY_SYSTEM || order?.orderStatus === OrderStatus.CANCELLED_BY_CUSTOMER;
      if (!order || !isTerminallyCancelled) return null;
      if (order.paymentStatus !== OrderPaymentStatus.PAID) return null;

      const payment = await manager.findOne(Payment, {
        where: { orderId, paymentStatus: PaymentGatewayStatus.SUCCEEDED },
        order: { completedAt: 'DESC' },
      });
      if (!payment) return null;

      const existingRefund = await manager.findOne(Refund, { where: { paymentId: payment.id } });
      if (existingRefund) return null;

      const provider = this.paymentProviders.getProvider(payment.paymentMethod);
      const goesThroughGateway = provider.supportsRefund && !!payment.gatewayTransactionId;

      const refundNumber = await this.nextRefundNumber(manager);
      const refund = manager.create(Refund, {
        refundNumber,
        paymentId: payment.id,
        orderId: order.id,
        amountCents: payment.amountCents,
        refundType: RefundType.FULL,
        reasonNotes,
        refundMethod: goesThroughGateway ? RefundMethod.ORIGINAL_METHOD : RefundMethod.WALLET_CREDIT,
        refundStatus: goesThroughGateway ? RefundStatus.PROCESSING : RefundStatus.COMPLETED,
        requestedByUserId: PLATFORM_SYSTEM_USER_ID,
        approvedByUserId: PLATFORM_SYSTEM_USER_ID,
        requestedAt: new Date(),
        approvedAt: new Date(),
        completedAt: goesThroughGateway ? null : new Date(),
        providerRefundId: null,
      });
      await manager.save(refund);

      return { order, payment, goesThroughGateway, provider, refund };
    });

    if (!prepared) return null;
    const { order, payment, goesThroughGateway, provider, refund } = prepared;

    let providerSucceeded = true;
    let providerRefundId: string | null = null;
    if (goesThroughGateway) {
      const providerResult = await provider.refund({
        providerReference: payment.gatewayTransactionId!,
        amountCents: payment.amountCents,
        reasonAr: reasonNotes,
      });
      providerSucceeded = providerResult.succeeded;
      providerRefundId = providerResult.succeeded ? providerResult.providerRefundId : null;
    }

    const finalRefund = await this.dataSource.transaction(async (manager) => {
      if (goesThroughGateway && !providerSucceeded) {
        refund.refundStatus = RefundStatus.REJECTED;
        await manager.save(refund);
        return refund;
      }

      if (goesThroughGateway) {
        refund.refundStatus = RefundStatus.COMPLETED;
        refund.providerRefundId = providerRefundId;
        refund.completedAt = new Date();
        await manager.save(refund);
      }

      if (refund.refundMethod === RefundMethod.WALLET_CREDIT) {
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
            descriptionAr: `استرجاع طلب ${order.orderNumber} — ${
              triggeredBy === 'customer_cancel' ? 'إلغاء العميل' : 'إلغاء نظامي'
            }`,
            allowNegativeBalance: true,
          },
          manager,
        );
      }

      payment.paymentStatus = PaymentGatewayStatus.REFUNDED;
      await manager.save(payment);

      order.paymentStatus = OrderPaymentStatus.REFUNDED;
      await manager.save(order);
      // orderStatus فضل CANCELLED_BY_SYSTEM/CANCELLED_BY_CUSTOMER عمدًا — مفيش صف
      // OrderStatusHistory إضافي هنا، الكولر (OrderAutoCancelService أو OrdersService.cancel())
      // سجّل بالفعل صف انتقال الحالة نفسه.

      return refund;
    });

    await this.auditLog.record({
      actorUserId: PLATFORM_SYSTEM_USER_ID,
      actorRole: 'system',
      action: finalRefund.refundStatus === RefundStatus.REJECTED ? 'order.refund_rejected' : 'order.refunded',
      entityType: 'order',
      entityId: orderId,
      newValues: {
        refund_id: finalRefund.id,
        amount_cents: finalRefund.amountCents,
        refund_status: finalRefund.refundStatus,
        trigger: triggeredBy,
      },
    });

    return finalRefund;
  }

  /**
   * ADR-0015 — بتتنادى من `PrepaidOrderSettlementListener` لما طلب يوصل `WORK_COMPLETED`.
   * Idempotent وآمنة تُنادى لأي طلب: بترجع بهدوء (`null`، بلا استثناء) لو مش الحالة المستهدفة
   * بالظبط — يشمل الطلب العادي (paymentStatus لسه UNPAID، هيكمل زي زمان عبر
   * collectCash/payWithWallet/payWithProvider العاديين، الميثود دي متلمسوش خالص).
   */
  async settleAlreadyPaidOrder(orderId: string): Promise<void> {
    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();
      if (!order) return null;
      if (order.orderStatus !== OrderStatus.WORK_COMPLETED) return null;
      if (order.paymentStatus !== OrderPaymentStatus.PAID) return null; // مش طلب مدفوع مسبقًا

      const owedNowCents = await this.amountOwedNow(order, manager);
      const previousStatus = order.orderStatus;

      if (owedNowCents <= 0) {
        // مفيش دلتا — الطلب كان مدفوع مسبقًا بالكامل، وخلص شغله بلا أي بند إضافي. تسوية فورية
        // تلقائية بلا أي دفعة جديدة أو تدخل من حد — كده الطلب بيتصرف بالظبط زي ما كان المفروض
        // من الأول (قبل البَقّة اللي ADR-0015 وثّقتها).
        await this.settleAndComplete(
          manager,
          order,
          (order.paymentMethod as PaymentMethod) ?? PaymentMethod.CARD,
          PLATFORM_SYSTEM_USER_ID,
          'system',
        );
        return { kind: 'settled' as const, order, previousStatus };
      }

      // فيه دلتا — بند إضافي اتوافق عليه بعد الدفع المسبق. الطلب بينتقل لـAWAITING_PAYMENT بس،
      // مفيش توزيع أرباح ولا COMPLETED لسه — assertPayable() بقت تسمح بمحاولة تحصيل جديدة تحديدًا
      // للحالة دي، وamountOwedNow() هترجع الدلتا بس (مش الإجمالي الكامل) لأي محاولة تحصيل جاية.
      order.orderStatus = OrderStatus.AWAITING_PAYMENT;
      await manager.save(order);
      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: OrderStatus.AWAITING_PAYMENT,
          changedByUserId: PLATFORM_SYSTEM_USER_ID,
          changedByRole: 'system',
          changeSource: OrderChangeSource.SYSTEM,
          reason: `دفع إضافي مطلوب — ${owedNowCents} قرش زيادة عن المبلغ المدفوع مسبقًا`,
        }),
      );
      return { kind: 'awaiting_payment' as const, order, previousStatus, owedNowCents };
    });

    if (!result) return;

    if (result.kind === 'settled') {
      this.events.emit(
        ORDER_STATUS_CHANGED_EVENT,
        new OrderStatusChangedEvent(
          result.order.id,
          result.order.orderNumber,
          result.previousStatus,
          OrderStatus.COMPLETED,
          result.order.customerId,
          result.order.technicianId,
        ),
      );
    } else {
      this.events.emit(
        ORDER_STATUS_CHANGED_EVENT,
        new OrderStatusChangedEvent(
          result.order.id,
          result.order.orderNumber,
          result.previousStatus,
          OrderStatus.AWAITING_PAYMENT,
          result.order.customerId,
          result.order.technicianId,
          `دفع إضافي مطلوب — ${result.owedNowCents} قرش`,
        ),
      );
    }
  }

  /** Rebuilds a missed WORK_COMPLETED event from durable order state in a bounded batch. */
  async reconcilePrepaidWorkCompleted(batchSize = 25): Promise<number> {
    const candidates = await this.orders.find({
      select: ['id'],
      where: {
        orderStatus: OrderStatus.WORK_COMPLETED,
        paymentStatus: OrderPaymentStatus.PAID,
      },
      order: { updatedAt: 'ASC' },
      take: Math.max(1, Math.floor(batchSize)),
    });

    let processed = 0;
    for (const candidate of candidates) {
      try {
        // The method locks and rechecks the order, so multiple app instances can sweep safely.
        await this.settleAlreadyPaidOrder(candidate.id);
        processed++;
      } catch (error) {
        this.logger.error(
          `فشل استرداد تسوية الطلب المدفوع مسبقًا ${candidate.id}`,
          error instanceof Error ? error.stack : error,
        );
      }
    }
    return processed;
  }

  /**
   * تصحيح محفظة يدوي (docs/08 §20 بند 5) — كانت فجوة حقيقية: `AdminWalletController` قراءة بس
   * (GET)، صفر مسار لأدمن/مالية يصحّح رصيد فني (مثلاً الفني سجّل تحصيل كاش غلط، الصح أقل).
   * **مبدأ append-only بالحرف**: مفيش تعديل لأي قيد قديم — قيد `ADJUSTMENT` جديد بس (نفس آلية
   * `doubleEntry()`/`reverseDoubleEntry()` الموجودة، صفر منطق محاسبي جديد)، فالتاريخ الأصلي
   * (مثلاً الـ`COMMISSION_DEDUCTION` وقت التسوية) يفضل زي ما هو للأبد — التصحيح ظاهر كحركة منفصلة
   * لها سببها وتوقيتها ومين عملها، مش استبدال للرقم القديم. محفظة المنصة هي الطرف التاني دايمًا
   * (نفس نمط bonus/penalty الموجودين بالفعل في `technician-kpi.service.ts`/`orders.service.ts`).
   */
  async adminAdjustWallet(
    adminUserId: string,
    targetUserId: string,
    amountCents: number,
    direction: 'credit' | 'debit',
    reasonAr: string,
    idempotencyKey: string,
    meta?: AuditActorMeta,
  ): Promise<{ debit: unknown; credit: unknown; newBalanceCents: number }> {
    const result = await this.dataSource.transaction(async (manager) => {
      const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID, manager);
      const targetWallet = await this.walletsService.findByUserIdOrThrow(targetUserId, manager);

      const inserted = await manager.query<{ id: string }[]>(
        `INSERT INTO wallet_adjustments
           (actor_user_id, target_user_id, target_wallet_id, idempotency_key, amount_cents, direction, reason_ar)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (actor_user_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [adminUserId, targetUserId, targetWallet.id, idempotencyKey, amountCents, direction, reasonAr],
      );

      const adjustment = inserted[0]
        ? await manager.findOneByOrFail(WalletAdjustment, { id: inserted[0].id })
        : await manager.findOneByOrFail(WalletAdjustment, { actorUserId: adminUserId, idempotencyKey });

      if (
        adjustment.targetUserId !== targetUserId ||
        adjustment.targetWalletId !== targetWallet.id ||
        adjustment.amountCents !== amountCents ||
        adjustment.direction !== direction ||
        adjustment.reasonAr !== reasonAr
      ) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'Idempotency-Key مستخدم قبل كده لعملية تصحيح مختلفة',
          HttpStatus.CONFLICT,
        );
      }

      if (!inserted[0]) {
        if (!adjustment.walletDebitTxId || !adjustment.walletCreditTxId) {
          throw new ApiException(ErrorCode.VAL_001, 'عملية التصحيح السابقة غير مكتملة', HttpStatus.CONFLICT);
        }
        const debit = await manager.findOneByOrFail(WalletTransaction, { id: adjustment.walletDebitTxId });
        const credit = await manager.findOneByOrFail(WalletTransaction, { id: adjustment.walletCreditTxId });
        const targetEntry = debit.walletId === targetWallet.id ? debit : credit;
        return { debit, credit, newBalanceCents: targetEntry.balanceAfterCents, adjustment, created: false };
      }

      const entry = await this.walletsService.doubleEntry(
        {
          fromWalletId: direction === 'credit' ? platformWallet.id : targetWallet.id,
          toWalletId: direction === 'credit' ? targetWallet.id : platformWallet.id,
          amountCents,
          transactionType: WalletTxType.ADJUSTMENT,
          referenceType: 'admin_adjustment',
          referenceId: adjustment.id,
          descriptionAr: reasonAr,
          performedByUserId: adminUserId,
          allowNegativeBalance: true,
        },
        manager,
      );

      adjustment.walletDebitTxId = entry.debit.id;
      adjustment.walletCreditTxId = entry.credit.id;
      await manager.save(adjustment);
      const targetEntry = entry.debit.walletId === targetWallet.id ? entry.debit : entry.credit;
      return { ...entry, newBalanceCents: targetEntry.balanceAfterCents, adjustment, created: true };
    });

    if (result.created) {
      await this.auditLog.record({
        actorUserId: adminUserId,
        actorRole: 'admin',
        action: 'wallet.adjusted',
        entityType: 'wallet_adjustment',
        entityId: result.adjustment.id,
        newValues: { target_user_id: targetUserId, amount_cents: amountCents, direction, reason_ar: reasonAr },
        meta,
      });
    }

    return { debit: result.debit, credit: result.credit, newBalanceCents: result.newBalanceCents };
  }
}
