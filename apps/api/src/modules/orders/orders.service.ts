import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, In, IsNull, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { JwtPayload } from '../auth/types/authenticated-request';
import { ORDER_CREATED_EVENT, OrderCreatedEvent } from '../../common/events/order-created.event';
import { ORDER_REMATCH_REQUESTED_EVENT, OrderRematchRequestedEvent } from '../../common/events/order-rematch-requested.event';
import { ORDER_RESCHEDULED_EVENT, OrderRescheduledEvent } from '../../common/events/order-rescheduled.event';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { TECHNICIAN_ORDER_CANCELLED_EVENT, TechnicianOrderCancelledEvent } from '../../common/events/technician-order-cancelled.event';
import { BuildingsService } from '../buildings/buildings.service';
import { AddressesService } from '../customers/addresses.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CatalogService } from '../catalog/catalog.service';
import { GeoService } from '../geo/geo.service';
import { PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from '../payments/entities/wallet.entity';
import { WalletTxType } from '../payments/entities/wallet-transaction.entity';
import { PaymentGatewayStatus } from '../payments/entities/payment.entity';
import { PaymentsService } from '../payments/payments.service';
import { WalletsService } from '../payments/wallets.service';
import { SettingsService } from '../settings/settings.service';
import { ComplaintCategory } from '../support/entities/complaint.entity';
import { SupportService } from '../support/support.service';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompaniesService } from '../technicians/technician-companies.service';
import { TechnicianScheduleService } from '../technicians/technician-schedule.service';
import { TechnicianScheduleSlot } from '../technicians/entities/technician-schedule-slot.entity';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { CancellationReasonsService } from './cancellation-reasons.service';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CancelOrderAsTechnicianDto } from './dto/cancel-order-as-technician.dto';
import { RequestRematchDto } from './dto/request-rematch.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { PreviewOrderDto } from './dto/preview-order.dto';
import { PreviewOrderResponseDto } from './dto/preview-order-response.dto';
import { FailedVisitReason, ReportFailedVisitDto } from './dto/report-failed-visit.dto';
import { ReportCashNotReceivedDto } from './dto/report-cash-not-received.dto';
import { RescheduleOrderDto } from './dto/reschedule-order.dto';
import { FailedVisitOutcome, ResolveFailedVisitDto } from './dto/resolve-failed-visit.dto';
import { CashDisputeOutcome, ResolveCashDisputeDto } from './dto/resolve-cash-dispute.dto';
import { TechnicianCancellationPolicyResponseDto } from './dto/technician-cancellation-policy-response.dto';
import { CancellationAppliesTo, CancellationReason } from './entities/cancellation-reason.entity';
import { BookingMode, Order, OrderPaymentStatus, OrderSourceChannel, OrderStatus, OrderType } from './entities/order.entity';
import { RecurringOrderFrequency, RecurringOrderTemplate } from './entities/recurring-order-template.entity';
import { nextOccurrence } from './recurring-schedule.util';
import { OrderItem, OrderItemType } from './entities/order-item.entity';
import { OrderMedia, OrderMediaType } from './entities/order-media.entity';
import { OrderTeamService } from './order-team.service';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';
import { CancellationRecoveryAction, TechnicianOrderCancellation } from './entities/technician-order-cancellation.entity';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, CUSTOMER_CANCELLABLE_STATUSES, canTransition } from './order-state-machine';
import { computeDispatchDeferredUntil } from './deferred-dispatch.util';
import { PromoCodesService } from '../promotions/promo-codes.service';

const CANCELLATION_FREE_WINDOW_FALLBACK_MINUTES = 5;
// سياسة إلغاء الفني (docs/10) — fallback بس، المصدر الحقيقي إعدادات cancellation.* (migration 0070).
const TECHNICIAN_CANCEL_WINDOW_MINUTES_FALLBACK = 10;
const TECHNICIAN_CANCEL_MIN_MINUTES_BEFORE_SCHEDULED_FALLBACK = 60;
// إعادة الجدولة (docs/08 §22 بند 9-12) متاحة بس قبل ما الفني يبدأ يتحرّك فعليًا — بعد
// technician_on_way الموعد بقى واقعي (الفني في الطريق)، تغييره في اللحظة دي مش "إعادة جدولة" لطلب
// مستقبلي، ده تصادم مع رحلة شغالة فعلاً.
const RESCHEDULABLE_STATUSES = new Set<OrderStatus>([OrderStatus.TECHNICIAN_ASSIGNED, OrderStatus.ACCEPTED]);

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

interface OptionalWarrantySelection {
  id: string;
  version: number;
  name_ar: string;
  warranty_type: string;
  pricing_model: 'fixed' | 'percentage';
  price_value: number;
  coverage_months: number;
  max_coverage_cents: number | null;
  max_claims: number;
  terms_ar: string | null;
  exclusions_ar: string | null;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(TechnicianOrderCancellation)
    private readonly technicianOrderCancellations: Repository<TechnicianOrderCancellation>,
    @InjectRepository(OrderMedia) private readonly orderMedia: Repository<OrderMedia>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditLog: AuditLogService,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly addressesService: AddressesService,
    private readonly catalogService: CatalogService,
    private readonly geoService: GeoService,
    private readonly techniciansService: TechniciansService,
    private readonly technicianCompaniesService: TechnicianCompaniesService,
    private readonly scheduleService: TechnicianScheduleService,
    private readonly pricingEngineService: PricingEngineService,
    private readonly promoCodesService: PromoCodesService,
    private readonly buildingsService: BuildingsService,
    private readonly cancellationReasonsService: CancellationReasonsService,
    private readonly walletsService: WalletsService,
    private readonly settingsService: SettingsService,
    private readonly paymentsService: PaymentsService,
    private readonly supportService: SupportService,
    private readonly events: EventEmitter2,
    // docs/08 §35، ADR-0021 §1 — آخر بند عمدًا (بعد events) عشان ياخد أقل بلاست-رديوس ممكن على
    // الاختبارات القديمة الكتير اللي بتبني OrdersService بـpositional args (append واحد بس).
    private readonly orderTeamService: OrderTeamService,
  ) {}

  private async resolveOptionalWarranty(
    planId: string | undefined,
    serviceId: string,
  ): Promise<OptionalWarrantySelection | null> {
    if (!planId) return null;
    const [plan] = await this.dataSource.query<OptionalWarrantySelection[]>(
      `SELECT wp.id, wp.version, wp.name_ar, wp.warranty_type, wp.pricing_model,
              wp.price_value::float AS price_value, wp.coverage_months,
              wp.max_coverage_cents, wp.max_claims, wp.terms_ar, wp.exclusions_ar
       FROM warranty_plans wp
       JOIN services s ON s.id = $2
       WHERE wp.id = $1 AND wp.is_active = true
         AND wp.slug <> 'system-service-workmanship'
         AND (wp.target_service_id = s.id OR wp.target_category_id = s.category_id)`,
      [planId, serviceId],
    );
    if (!plan) {
      throw new ApiException(ErrorCode.VAL_001, 'خطة الضمان غير متاحة لهذه الخدمة', HttpStatus.BAD_REQUEST);
    }
    return plan;
  }

  private optionalWarrantyPrice(plan: OptionalWarrantySelection | null, serviceTotalCents: number): number {
    if (!plan) return 0;
    return plan.pricing_model === 'fixed'
      ? Math.round(plan.price_value)
      : Math.round((serviceTotalCents * plan.price_value) / 100);
  }

  findAllForCustomerUser(userId: string): Promise<Order[]> {
    return this.customerProfiles.findByUserIdOrThrow(userId).then((profile) =>
      this.orders.find({ where: { customerId: profile.id }, order: { createdAt: 'DESC' } }),
    );
  }

  async findOneOwnedOrThrow(userId: string, orderId: string): Promise<Order> {
    const profile = await this.customerProfiles.findByUserIdOrThrow(userId);
    const order = await this.orders.findOne({ where: { id: orderId, customerId: profile.id } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
    }
    return order;
  }

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

  async create(
    userId: string,
    dto: CreateOrderDto,
    recurringIdentity?: { templateId: string; scheduledFor: Date },
    // Call Center — إنشاء طلب نيابة عن عميل (Script 4 §33-37). userId هنا يفضل userId العميل
    // نفسه دايمًا (الطلب بيتملك للعميل، مش للموظف) — الفرق الوحيد هو الحقل ده، بيحدد source_channel
    // + created_by_admin_user_id للتدقيق. AdminOrdersController هو المسؤول عن التحقق من الصلاحية
    // (orders.create_for_customer) قبل ما ينادي هنا أصلاً.
    callCenterContext?: { adminUserId: string; meta?: AuditActorMeta },
    // Idempotency-Key (docs/01 §1.4، migration 0139، Script 7 Phase 9) — اختياري (recurring-orders
    // مش بيبعته، عنده حماية تانية أصلاً). لو اتبعت، أي نداء تاني بنفس المفتاح لنفس العميل بيرجّع
    // نفس الطلب الأصلي فورًا بدل ما ينشئ نسخة جديدة (double-click/retry شبكة).
    idempotencyKey?: string,
  ): Promise<Order> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);

    // فحص مبكر رخيص قبل أي عمل تاني — الفحص الحاسم فعليًا هو الفهرس الفريد الجزئي على
    // (customer_id, idempotency_key) (migration 0139)، ده بس تحسين أداء لتفادي كل منطق التسعير/
    // التحقق لأي retry واضح بدري.
    if (idempotencyKey) {
      const existing = await this.orders.findOne({ where: { customerId: customerProfile.id, idempotencyKey } });
      if (existing) return existing;
    }

    const address = await this.addressesService.findOwnedOrThrow(userId, dto.address_id);
    const service = await this.catalogService.findServiceOrThrow(dto.service_id);
    const optionalWarranty = await this.resolveOptionalWarranty(dto.warranty_plan_id, service.id);

    // هيكل الحجز الجديد (docs/06 §1) — التلات أزرار (فرد/اعتماد/طوارئ) بتترجم مباشرة لتحقق
    // إن الخدمة المطلوبة أصلاً بتدعم الوضع ده (allows_individual/allows_team/allows_emergency
    // على service.entity.ts، مضبوطة من الأدمن عبر /admin/services).
    const bookingMode = dto.booking_mode ?? BookingMode.INDIVIDUAL;
    const bookingModeAllowed =
      bookingMode === BookingMode.INDIVIDUAL
        ? service.allowsIndividual
        : bookingMode === BookingMode.TEAM
          ? service.allowsTeam
          : service.allowsEmergency;
    if (!bookingModeAllowed) {
      throw new ApiException(ErrorCode.VAL_001, 'وضع الحجز ده مش متاح لهذه الخدمة', HttpStatus.BAD_REQUEST);
    }

    // قدرة دفع لكل خدمة (ADR-0026، docs/08 §42 Phase A.1) — cash_allowed=false يعني الخدمة دي
    // مينفعش تتقفل بكاش خالص (لازم كارت/InstaPay مقدّم). غياب dto.payment_method يعني كاش ضمنيًا
    // (نفس منطق requestedPrepayMethod تحت بالحرف). إعادة الزيارة تحت الضمان (original_order_id)
    // مستثناة عمدًا — مجانية بالكامل دايمًا (originalOrder ? undefined : ...)، فمفيش كاش فعلي
    // يتحصّل أصلاً عشان يتفحص.
    if (!dto.payment_method && !dto.original_order_id && !service.cashAllowed) {
      throw new ApiException(ErrorCode.VAL_001, 'الدفع كاش مش متاح لهذه الخدمة — لازم تختار بطاقة أو InstaPay أو فوري', HttpStatus.BAD_REQUEST);
    }

    // سياسة إيداع (ADR-0027، docs/08 §42 Phase A.3) — كاش مينفعش يتقسّم "إيداع دلوقتي + باقي
    // بعدين" فعليًا (بيتحصّل يدًا بيد مرة واحدة وقت الاستلام)، فخدمة deposit_required=true لازم
    // دفع مقدّم إلكتروني إجباري بغض النظر عن cash_allowed. نفس استثناء إعادة الزيارة فوق بالحرف
    // (مجانية بالكامل، مفيش إيداع يتحصّل أصلاً).
    if (!dto.payment_method && !dto.original_order_id && service.depositRequired) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'هذه الخدمة تتطلب دفع إيداع مقدّم — لازم تختار بطاقة أو InstaPay أو فوري',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Script 7 Phase 7 — بَقّة حقيقية اتلقطت: الطوارئ (docs/06) معناها استجابة فورية بالتعريف
    // (نفس التعليق موثّق تحت لـ`schedule_slot_id`)، لكن الفحص القديم كان بيمنع `schedule_slot_id`
    // بس مع الطوارئ — `dto.scheduled_at` الحر (بلا سلوت محدد) كان بيعدّي عادي، فيتسجّل طلب
    // `orderType=EMERGENCY` بـ`scheduledAt` في المستقبل، وبعدين `computeDispatchDeferredUntil()`
    // بيؤجّل بث المطابقة فعليًا ساعات — عميل دافع رسوم طوارئ إضافية (`emergency_surcharge_cents`)
    // بينتظر بلا أي استجابة "فورية" فعلية، عكس تعريف الوضع ده تمامًا.
    if (bookingMode === BookingMode.EMERGENCY && dto.scheduled_at) {
      throw new ApiException(ErrorCode.VAL_001, 'طلبات الطوارئ استجابة فورية — مينفعش تتحدد بموعد مستقبلي', HttpStatus.BAD_REQUEST);
    }

    if (dto.requested_technician_company_id) {
      if (bookingMode !== BookingMode.TEAM) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'اختيار شركة/فريق محدد متاح بس لوضع "اعتماد"',
          HttpStatus.BAD_REQUEST,
        );
      }
      await this.technicianCompaniesService.findActiveCompanyOrThrow(dto.requested_technician_company_id);
    }

    if (!address.cityId) {
      throw new ApiException(ErrorCode.ORDR_001, 'العنوان مش مربوط بمدينة', HttpStatus.BAD_REQUEST);
    }
    // point-in-polygon حقيقي لو فيه نطاقات في المدينة عندها boundary مرسوم، وإلا fallback
    // لأول نطاق نشط في المدينة (نفس السلوك القديم) — تفاصيل في geo/README.md.
    const [longitude, latitude] = address.location.coordinates;
    const zone = await this.geoService.findZoneForPoint(address.cityId, latitude, longitude);
    if (!zone) {
      throw new ApiException(ErrorCode.ORDR_001, 'الخدمة غير متاحة في منطقتك لسه', HttpStatus.BAD_REQUEST);
    }

    // أوضاع التوقيت الأربعة (ADR-0032) — تبادلية على مستوى الـDB (CHECK constraint
    // chk_services_scheduling_mode_exclusive، على الأكتر وضع واحد فعّال لكل خدمة). هنا بنتحقق
    // من الحقول المطلوبة/الممنوعة حسب الوضع الفعّال للخدمة دي بالظبط. requiresPreciseSchedule
    // (ADR-0031 Slice B) — صفر تغيير سلوك.
    if (service.requiresPreciseSchedule) {
      if (!dto.scheduled_at) {
        throw new ApiException(ErrorCode.VAL_001, 'لازم تحدد معاد الحجز لخدمة بدقة وقت', HttpStatus.BAD_REQUEST);
      }
      if (!dto.duration_hours) {
        throw new ApiException(ErrorCode.VAL_001, 'لازم تحدد عدد الساعات المطلوبة لخدمة بدقة وقت', HttpStatus.BAD_REQUEST);
      }
      if (dto.scheduled_end_at) {
        throw new ApiException(ErrorCode.VAL_001, 'scheduled_end_at متاحة بس للخدمات اللي محتاجة بداية ونهاية', HttpStatus.BAD_REQUEST);
      }
    } else if (service.requiresStartTimeOnly) {
      if (!dto.scheduled_at) {
        throw new ApiException(ErrorCode.VAL_001, 'لازم تحدد معاد بداية الخدمة دي', HttpStatus.BAD_REQUEST);
      }
      if (dto.duration_hours) {
        throw new ApiException(ErrorCode.VAL_001, 'duration_hours مش مطلوبة لخدمة محتاجة وقت بداية بس', HttpStatus.BAD_REQUEST);
      }
      if (dto.scheduled_end_at) {
        throw new ApiException(ErrorCode.VAL_001, 'scheduled_end_at متاحة بس للخدمات اللي محتاجة بداية ونهاية', HttpStatus.BAD_REQUEST);
      }
    } else if (service.requiresHoursOnly) {
      if (!dto.duration_hours) {
        throw new ApiException(ErrorCode.VAL_001, 'لازم تحدد عدد الساعات المطلوبة', HttpStatus.BAD_REQUEST);
      }
      if (dto.scheduled_end_at) {
        throw new ApiException(ErrorCode.VAL_001, 'scheduled_end_at متاحة بس للخدمات اللي محتاجة بداية ونهاية', HttpStatus.BAD_REQUEST);
      }
    } else if (service.requiresStartAndEnd) {
      if (!dto.scheduled_at) {
        throw new ApiException(ErrorCode.VAL_001, 'لازم تحدد تاريخ ووقت بداية الخدمة', HttpStatus.BAD_REQUEST);
      }
      if (!dto.scheduled_end_at) {
        throw new ApiException(ErrorCode.VAL_001, 'لازم تحدد تاريخ ووقت نهاية الخدمة', HttpStatus.BAD_REQUEST);
      }
      if (new Date(dto.scheduled_end_at) <= new Date(dto.scheduled_at)) {
        throw new ApiException(ErrorCode.VAL_001, 'وقت النهاية لازم يكون بعد وقت البداية', HttpStatus.BAD_REQUEST);
      }
      if (dto.duration_hours) {
        throw new ApiException(ErrorCode.VAL_001, 'duration_hours مش مطلوبة لخدمة محتاجة بداية ونهاية', HttpStatus.BAD_REQUEST);
      }
    } else {
      if (dto.duration_hours) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'duration_hours متاحة بس للخدمات اللي محتاجة دقة وقت أو عدد ساعات',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (dto.scheduled_end_at) {
        throw new ApiException(ErrorCode.VAL_001, 'scheduled_end_at متاحة بس للخدمات اللي محتاجة بداية ونهاية', HttpStatus.BAD_REQUEST);
      }
    }

    // "إعادة الحجز" — نتأكد إن الـ id فعلاً فني حقيقي بس (404 واضح لو لأ)، مش هل هو متاح/مؤهّل
    // للخدمة دي تحديداً — ده بيتفحص وقت المطابقة نفسها (matching.service.ts)، فالتفضيل ده
    // ببساطة بيتجاهَل بأمان لو مش قابل للتطبيق بدل ما يمنع إنشاء الطلب. **منقولة قبل estimate()**
    // (كانت بعده) عشان نعرف مستوى الفني المطلوب ونطبّق مضاعف سعره الصح من أول تقدير — مبدأ عمل
    // صريح: "السعر النهائي معروف قبل التأكيد، مفيش زيادة مفاجئة بعده" (تفاصيل تحت).
    let requestedTechnicianProfile: TechnicianProfile | null = null;
    if (dto.requested_technician_id) {
      requestedTechnicianProfile = await this.techniciansService.findByProfileIdOrThrow(dto.requested_technician_id);
    }

    // الجدولة الحقيقية للفني (docs/08 §2-§3، ADR-0002) — كانت `TechnicianScheduleService.bookSlot()`
    // primitive جاهز ومختبر بلا أي caller خالص. العميل اختار سلوت `available` محدد من جدول فني
    // بعينه (GET /technicians/:id/schedule)، ده أقوى من "تفضيل" عادي (requested_technician_id) —
    // الفني نفسه حدد صراحة إنه فاضي في التاريخ/الوقت ده. متبادل استبعادياً مع الطوارئ (استجابة
    // فورية، مش موعد مستقبلي بمعنى مختلف تمامًا) وإعادة الزيارة (بترجع لنفس الفني الأصلي
    // تلقائيًا أصلاً). **قرار موثّق صراحة**: التوزيع لسه فوري وقت إنشاء الطلب مش مؤجّل لوقت
    // السلوت نفسه — نفس السلوك الحالي بالظبط لـ`scheduled_at` العادي (توزيع مؤجل حقيقي محتاج
    // queue جديد بالكامل مش موجود حتى للحقل القديم، فمش هنخترعه بس هنا).
    let scheduleSlot: TechnicianScheduleSlot | null = null;
    if (dto.schedule_slot_id) {
      if (bookingMode === BookingMode.EMERGENCY) {
        throw new ApiException(ErrorCode.VAL_001, 'حجز سلوت وقت محدد مش متاح لطلبات الطوارئ', HttpStatus.BAD_REQUEST);
      }
      if (dto.original_order_id) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'إعادة الزيارة تحت الضمان بترجع لنفس الفني الأصلي تلقائيًا — مينفعش تختار سلوت كمان',
          HttpStatus.BAD_REQUEST,
        );
      }
      scheduleSlot = await this.scheduleService.findAvailableSlotOrThrow(dto.schedule_slot_id);
      if (dto.requested_technician_id && dto.requested_technician_id !== scheduleSlot.technicianId) {
        throw new ApiException(ErrorCode.VAL_001, 'السلوت المختار بتاع فني مختلف عن الفني المطلوب — اختار واحد بس', HttpStatus.BAD_REQUEST);
      }
    }

    // دقة الوقت (ADR-0031 Slice B) — فحص تعارض حقيقي بدقة ساعة (مش يوم، ADR-0018) لما الفني
    // معروف صراحة سلفًا (تفضيل أو سلوت). لو العميل سايب المطابقة تختار (auto-match)، بوابة الأهلية
    // العادية بمستوى اليوم (technicianAvailabilityCondition) هي اللي بتشتغل وقت التوزيع — فحص
    // ساعي إضافي وقت التوزيع التلقائي نفسه مؤجّل عمدًا (فجوة موثّقة، مش سهو).
    const preciseScheduleTechnicianId = scheduleSlot?.technicianId ?? requestedTechnicianProfile?.id ?? null;
    if (service.requiresPreciseSchedule && preciseScheduleTechnicianId && dto.scheduled_at && dto.duration_hours) {
      await this.assertNoPreciseScheduleConflict(preciseScheduleTechnicianId, new Date(dto.scheduled_at), dto.duration_hours);
    }

    // "مرن — اختار نطاق أيام" (docs/08 §32.3، طلب مالك صريح 2026-08-20) — بندوّر يوم بيوم داخل
    // [scheduled_at, scheduled_at_range_end] (الاتنين شاملين) على أقرب يوم فيه فني مؤهّل واحد على
    // الأقل فعليًا، ونستبدل به dto.scheduled_at الحرفي تحت. لو محدش متاح في كل النطاق، بنسيب أول
    // يوم في النطاق كما هو — نفس فلسفة "مفيش إلغاء تلقائي لمجرد مفيش فني دلوقتي"
    // (MatchingRecoveryService.sweep() هتعيد المحاولة تلقائيًا بعد إنشاء الطلب).
    let resolvedScheduledAtIso: string | undefined = dto.scheduled_at;
    if (dto.scheduled_at_range_end) {
      // قدرة "نطاق أيام مرن" لكل خدمة (ADR-0028، docs/08 §42 Phase A.2) — نفس نمط allows_individual/
      // cash_allowed بالحرف. صفر لمس لمنطق حل النطاق تحت — بوابة دخول بس.
      if (!service.allowsDateRangeBooking) {
        throw new ApiException(ErrorCode.VAL_001, 'حجز نطاق أيام مرن مش متاح لهذه الخدمة — لازم تحدد يوم واحد', HttpStatus.BAD_REQUEST);
      }
      if (!dto.scheduled_at) {
        throw new ApiException(ErrorCode.VAL_001, 'نطاق الأيام المرن محتاج تاريخ بداية (scheduled_at)', HttpStatus.BAD_REQUEST);
      }
      if (scheduleSlot) {
        throw new ApiException(ErrorCode.VAL_001, 'مينفعش تحدد نطاق أيام مرن مع سلوت وقت محدد', HttpStatus.BAD_REQUEST);
      }
      const rangeStart = new Date(dto.scheduled_at);
      const rangeEnd = new Date(dto.scheduled_at_range_end);
      const rangeDays = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / (24 * 60 * 60 * 1000));
      if (rangeDays < 0 || rangeDays > 14) {
        throw new ApiException(ErrorCode.VAL_001, 'نطاق الأيام المرن لازم يكون بين يوم و14 يوم', HttpStatus.BAD_REQUEST);
      }
      for (let offset = 0; offset <= rangeDays; offset += 1) {
        const candidateDay = new Date(rangeStart.getTime() + offset * 24 * 60 * 60 * 1000);
        // eslint-disable-next-line no-await-in-loop -- تسلسلي عمدًا: أول يوم متاح يوقف الحلقة فورًا، مش كل الأيام دايمًا.
        const eligible = await this.techniciansService.hasEligibleTechnicianForDate(service.id, zone.id, address.id, candidateDay);
        if (eligible) {
          resolvedScheduledAtIso = candidateDay.toISOString();
          break;
        }
      }
    }

    // مضاعف سعر مستوى الفني (docs/08 — "قرار عمل: السعر النهائي معروف قبل التأكيد") — بيتطبّق
    // بس لو الفني معروف صراحة وقت الحجز (اختيار مباشر أو سلوت جدولة)، مش لو العميل سايب المطابقة
    // تختار (technicianLevel=undefined يبقى مضاعف=1 داخل estimate()، زي ما كان بالظبط). سلوت
    // الجدولة بيغلب requested_technician_id لو الاتنين موجودين (نفس أولوية اختيار الفني تحت).
    const scheduleSlotTechnicianProfile = scheduleSlot
      ? await this.techniciansService.findByProfileIdOrThrow(scheduleSlot.technicianId)
      : null;
    const knownTechnicianLevel = scheduleSlotTechnicianProfile?.currentLevel ?? requestedTechnicianProfile?.currentLevel;
    // فئة التسعير التجارية (docs/08 §36.24، ADR-0025) — نفس منطق knownTechnicianLevel فوق بالحرف،
    // مصدر مستقل (technician_profiles.pricing_tier) عشان الفصل الكامل عن currentLevel التشغيلي.
    const knownTechnicianPricingTier = scheduleSlotTechnicianProfile?.pricingTier ?? requestedTechnicianProfile?.pricingTier;

    const estimate = await this.catalogService.estimate(
      service.id,
      zone.id,
      knownTechnicianLevel,
      bookingMode === BookingMode.EMERGENCY,
      dto.field_values,
      knownTechnicianPricingTier,
      dto.duration_hours,
    );
    const addons = await this.catalogService.findAddonsByIds(service.id, dto.addon_ids ?? []);
    const addonsTotalCents = addons.reduce((sum, addon) => sum + addon.priceCents, 0);

    // محرك الإنتاجية (docs/06 §3.3-§3.6) — قرار عمل من المالك: القيم المحسوبة هنا بتتسجّل
    // snapshot على الطلب نفسه (مش مجرد معاينة زي POST /services/:id/estimate-duration)، عشان
    // تفضل ظاهرة لفريق العمليات/الفني حتى لو الأدمن غيّر service_standard_data بعدين.
    let durationEstimate: Awaited<ReturnType<CatalogService['estimateDuration']>> | null = null;
    // بَقّة حقيقية اتلقطت (Script 7 Phase 5): الفحص القديم `&&` كان بيسمح بالظبط بالحالة الممنوعة
    // في تعليق DTO نفسه ("الاتنين لازم يتبعتوا مع بعض أو ولا واحد فيهم") — لو العميل بعت واحد بس
    // من standard_data_id/requested_units، الكود كان بيتجاهله بصمت ويحفظ الطلب بـrequiredTechnicians/
    // requiredAssistants=null بلا أي خطأ، فمطابقة المساعدين (assistant-matching.service.ts) كانت
    // بتتخطى تمامًا (`if (!order.requiredAssistants...) return;`) لشغلانة ممكن تحتاج طاقم فعليًا.
    if (Boolean(dto.standard_data_id) !== Boolean(dto.requested_units)) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'standard_data_id وrequested_units لازم يتبعتوا مع بعض — مينفعش واحد من غير التاني',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dto.standard_data_id && dto.requested_units) {
      durationEstimate = await this.catalogService.estimateDuration(service.id, dto.standard_data_id, dto.requested_units);
    }

    // docs/01B — تكامل Price Engine → Booking: مخرجات المعادلة التشغيلية (طاقم/مدة/ملاءمة
    // طوارئ) بتوصل هنا رسميًا. الأولوية لمسار الإنتاجية القياسي (standard_data) لو العميل
    // استخدمه صراحةً — ده المسار المقتبس من العميل؛ مخرجات المعادلة بتملأ الفراغ.
    const formulaCrewTechnicians =
      !durationEstimate && estimate.required_technicians != null ? estimate.required_technicians : null;
    const formulaCrewAssistants =
      !durationEstimate && estimate.required_assistants != null ? estimate.required_assistants : null;
    const formulaDurationDays =
      !durationEstimate && estimate.estimated_duration_days != null ? estimate.estimated_duration_days : null;
    if (bookingMode === BookingMode.EMERGENCY && estimate.suitable_for_emergency === false) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'الخدمة دي مش مناسبة لطلب طوارئ بالمواصفات دي حسب سياسة التسعير — احجزها بموعد عادي',
        HttpStatus.BAD_REQUEST,
      );
    }

    // إعادة زيارة تحت الضمان (docs/08 §7) — لازم: بتاعة نفس العميل، مكتملة فعلاً، لنفس الخدمة
    // ونفس العنوان بالظبط (نفس المشكلة المفروض)، وتحت warranty_expires_at الفعلي لسه. تفضيل
    // (مش ضمان) بيروح لنفس الفني الأصلي — requested_technician_id بتاعه بيتجاهَل ويتحل محله.
    let originalOrder: Order | null = null;
    if (dto.original_order_id) {
      originalOrder = await this.orders.findOne({ where: { id: dto.original_order_id, customerId: customerProfile.id } });
      if (!originalOrder) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب الأصلي غير موجود', HttpStatus.NOT_FOUND);
      }
      if (originalOrder.orderStatus !== OrderStatus.COMPLETED) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب الأصلي لازم يكون مكتمل الأول', HttpStatus.BAD_REQUEST);
      }
      // بَقّة حقيقية اتلقطت (Script 7 Phase 23): إعادة الزيارة نفسها بتاخد warranty_expires_at
      // جديدة بالكامل وقت اكتمالها (نفس مسار settleAndComplete() اللي بيحسبها لأي طلب مكتمل، مفيش
      // استثناء لـorder_type=revisit) — من غير الفحص ده، كانت إعادة زيارة تقدر تبقى original_order_id
      // لإعادة زيارة تانية، وهكذا للأبد: خدمة مجانية بلا نهاية لنفس العميل/العنوان/الخدمة كل ما
      // الضمان يقرب يخلص، بلا أي تعويض للفني بعد الطلب الأصلي. الضمان معناه "نصلح نفس المشكلة تاني
      // لو رجعت"، مش "سلسلة زيارات مجانية بلا حد" — إعادة الزيارة نفسها مينفعش تبقى أصل لإعادة زيارة تانية.
      if (originalOrder.orderType === OrderType.REVISIT) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'إعادة الزيارة تحت الضمان مسموحة مرة واحدة بس لكل طلب أصلي — مينفعش تعمل إعادة زيارة لإعادة زيارة تانية',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (originalOrder.serviceId !== dto.service_id || originalOrder.addressId !== dto.address_id) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'إعادة الزيارة لازم تكون لنفس الخدمة ونفس العنوان بالظبط',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!originalOrder.warrantyExpiresAt || originalOrder.warrantyExpiresAt.getTime() < Date.now()) {
        throw new ApiException(ErrorCode.VAL_001, 'ضمان الطلب الأصلي انتهى', HttpStatus.BAD_REQUEST);
      }
      if (dto.promo_code || dto.building_code || (dto.addon_ids && dto.addon_ids.length > 0)) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'إعادة الزيارة تحت الضمان مجانية بالكامل — مفيش كود خصم ولا إضافات كتالوج معاها',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    if (originalOrder && optionalWarranty) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'إعادة الزيارة تحت الضمان مجانية ولا تقبل شراء ضمان إضافي',
        HttpStatus.BAD_REQUEST,
      );
    }

    // "كرّر الحجز ده" (migration 0176) — بوابة الدخول للقالب المتكرر المُنشأ من مسار الحجز
    // العادي. نفس فلسفة كل بوابات القدرة فوق: رفض واضح وقت الطلب بدل حالة نصف جاهزة.
    // التكرار معناه "نفس الحجز ده يتكرر" فمحتاج موعد فعلي محدد + خدمة مفعّل فيها التكرار +
    // مش طوارئ/إعادة زيارة (الاتنين ليهم دلالة زمنية مختلفة تمامًا عن التكرار المجدول).
    let repeatPlanFrequency: RecurringOrderFrequency | null = null;
    if (dto.repeat_frequency) {
      if (optionalWarranty) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'الضمان الإضافي يُختار لكل طلب على حدة ولا يمكن تثبيته على حجز متكرر',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (dto.payment_method === 'fawry_reference') {
        throw new ApiException(
          ErrorCode.VAL_001,
          'فوري متاح للحجز الحالي فقط؛ الحجز المتكرر يحتاج بطاقة أو InstaPay',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (originalOrder) {
        throw new ApiException(ErrorCode.VAL_001, 'إعادة الزيارة تحت الضمان مينفعش تتكرر', HttpStatus.BAD_REQUEST);
      }
      if (bookingMode === BookingMode.EMERGENCY) {
        throw new ApiException(ErrorCode.VAL_001, 'طلبات الطوارئ استجابة فورية — مينفعش تتكرر بموعد ثابت', HttpStatus.BAD_REQUEST);
      }
      if (!service.allowsRecurringBooking) {
        throw new ApiException(ErrorCode.VAL_001, 'الحجز المتكرر مش متاح لهذه الخدمة', HttpStatus.BAD_REQUEST);
      }
      if (!scheduleSlot && !resolvedScheduledAtIso) {
        throw new ApiException(ErrorCode.VAL_001, 'التكرار محتاج موعد محدد — حدد يوم التنفيذ الأول', HttpStatus.BAD_REQUEST);
      }
      repeatPlanFrequency = dto.repeat_frequency as RecurringOrderFrequency;
    }

    // شروط الدفع بعد الخدمة (migration 0177) — إجبارية من الباك-إند: طلب غير مدفوع مقدّمًا على
    // خدمة عليها سياسة required لازم يحمل قبول النسخة الحالية، وإلا رفض واضح. الطلبات المدفوعة
    // مقدمًا (كارت/InstaPay) وإعادة الزيارة المجانية مستثناة — الشروط دي عن "الدفع لاحقًا".
    let postpaidPolicyVersionIds: string[] = [];
    if (!dto.payment_method && !originalOrder) {
      const required = await this.dataSource.query<{ id: string; title_ar: string }[]>(
        `SELECT v.id, p.title_ar
         FROM payment_policies p
         JOIN LATERAL (
           SELECT id, version FROM payment_policy_versions
           WHERE policy_id = p.id ORDER BY version DESC LIMIT 1
         ) v ON true
         WHERE p.is_active = true AND p.is_required = true AND p.applies_to = 'postpaid_service'
           AND (p.target_service_id IS NULL OR p.target_service_id = $1)
           AND (p.target_category_id IS NULL OR p.target_category_id = $2)
         ORDER BY p.target_service_id NULLS LAST`,
        [service.id, service.categoryId],
      );
      const acceptedSet = new Set(dto.accepted_policy_version_ids ?? []);
      const missing = required.filter((r) => !acceptedSet.has(r.id));
      if (missing.length > 0) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `لازم توافق على شروط الدفع: ${missing.map((m) => m.title_ar).join('، ')}`,
          HttpStatus.BAD_REQUEST,
        );
      }
      postpaidPolicyVersionIds = required.map((r) => r.id);
    }

    // نظام العمائر (docs/08 §13، ADR-0003) — متبادل استبعادياً مع promo_code (مش الاتنين مع
    // بعض، القرار الكامل في ADR-0003). الحل بيتم قبل الـ transaction (مجرد قراءة، مفيش كتابة
    // زي promo_code اللي محتاج order.id يتسجّل في promo_code_usages).
    if (dto.promo_code && dto.building_code) {
      throw new ApiException(ErrorCode.VAL_001, 'مينفعش تستخدم كود خصم وكود عمارة مع بعض', HttpStatus.BAD_REQUEST);
    }
    const building = dto.building_code ? await this.buildingsService.findActiveByCodeOrThrow(dto.building_code) : null;

    // لازم يتحسب قبل الـ transaction (مش جواها بعد ما الطلب الحالي يتحفظ) — وإلا COUNT(*)
    // هيشوف الطلب الحالي نفسه (نفس الـtransaction) ويحسبه غلط كإنه "مش أول طلب".
    const isNewCustomer = dto.promo_code ? await this.customerProfiles.isNewCustomer(customerProfile.id) : false;

    // دفع قبل التوزيع (ADR-0013 §3/§4/§12) — إعادة زيارة مجانية بالكامل (originalOrder) دايمًا
    // بتتوزّع فورًا بغض النظر عن dto.payment_method (مفيش حاجة تتدفع أصلاً)، ونفس المنطق لو
    // إجمالي الطلب صفر لأي سبب تاني (خصم كامل مثلاً) — دفع كارت/InstaPay بمبلغ صفر مالوش معنى.
    // requiresPrepay النهائية بتتحدد بعد ما totalAmountCents يتحسب فعليًا جوّه الـtransaction تحت.
    const requestedPrepayMethod = originalOrder ? undefined : dto.payment_method;

    let createdOrder: Order;
    try {
      createdOrder = await this.dataSource.transaction(async (manager) => {
      const [{ next_human_readable_number: orderNumber }] = await manager.query<
        { next_human_readable_number: string }[]
      >("SELECT next_human_readable_number('ORD')");

      const now = new Date();
      const order = manager.create(Order, {
        orderNumber,
        customerId: customerProfile.id,
        serviceId: service.id,
        addressId: address.id,
        serviceZoneId: zone.id,
        // bookingMode=emergency بيفرض orderType=EMERGENCY دايماً (مهما اتبعت dto.order_type)،
        // وإعادة الزيارة بتفرض orderType=REVISIT بنفس المنطق — الاتنين مصدر الحقيقة الوحيد هنا.
        orderType: originalOrder
          ? OrderType.REVISIT
          : bookingMode === BookingMode.EMERGENCY
            ? OrderType.EMERGENCY
            : (dto.order_type ?? OrderType.STANDARD),
        bookingMode,
        requestedTechnicianCompanyId: dto.requested_technician_company_id ?? null,
        orderStatus: OrderStatus.SEARCHING_TECHNICIAN,
        // دقة الوقت (ADR-0031 Slice B) + وضع "عدد ساعات بس" (ADR-0032) — الاتنين بيسجّلوا
        // duration_hours، اتفحصت فوق إنها موجودة/ممنوعة حسب الوضع الفعّال للخدمة.
        durationHours: service.requiresPreciseSchedule || service.requiresHoursOnly ? (dto.duration_hours ?? null) : null,
        problemDescription: dto.problem_description ?? null,
        customerNotes: dto.customer_notes ?? null,
        // سلوت الجدولة (لو اتحجز) بيحدد الموعد المطلوب فعليًا — أدق من resolvedScheduledAtIso
        // (تاريخ/وقت السلوت نفسه اللي الفني أعلن عنه، UTC مباشرة زي باقي أوقات المشروع).
        // resolvedScheduledAtIso = dto.scheduled_at الحر، أو أقرب يوم متاح فعليًا داخل النطاق
        // المرن لو dto.scheduled_at_range_end اتبعت (docs/08 §32.3).
        scheduledAt: scheduleSlot
          ? new Date(`${scheduleSlot.slotDate}T${scheduleSlot.startTime}Z`)
          : resolvedScheduledAtIso
            ? new Date(resolvedScheduledAtIso)
            : null,
        // وضع "بداية+نهاية" (ADR-0032) — بس لخدمات requiresStartAndEnd=true (اتفحصت فوق).
        scheduledEndAt: service.requiresStartAndEnd && dto.scheduled_end_at ? new Date(dto.scheduled_end_at) : null,
        projectId: dto.project_id ?? null,
        milestoneId: dto.milestone_id ?? null,
        recurringTemplateId: recurringIdentity?.templateId ?? null,
        recurringOccurrenceAt: recurringIdentity?.scheduledFor ?? null,
        // إعادة الزيارة بتفضّل نفس الفني الأصلي دايماً، وسلوت الجدولة (لو اتحجز) بيحدد فني
        // السلوت نفسه — requested_technician_id بتاع الـ dto بيتجاهَل هنا عمداً في الحالتين.
        requestedTechnicianId: originalOrder
          ? originalOrder.technicianId
          : scheduleSlot
            ? scheduleSlot.technicianId
            : (dto.requested_technician_id ?? null),
        parentOrderId: originalOrder ? originalOrder.id : null,
        buildingId: building ? building.id : null,
        warrantyPlanId: optionalWarranty?.id ?? null,
        warrantyPriceCents: 0,
        warrantyPlanSnapshot: optionalWarranty ? { ...optionalWarranty } : null,
        // إعادة زيارة تحت الضمان = مجانية بالكامل (docs/08 §7) — مفيش سعر تقديري، مفيش إضافات
        // كتالوج، مفيش كود خصم؛ الطلب ده لنفس المشكلة الأصلية بس مش فرصة شراء إضافية.
        estimatedPriceCents: originalOrder ? 0 : estimate.estimated_total_cents,
        inspectionFeeCents: originalOrder ? 0 : estimate.inspection_fee_cents,
        // رسوم الطوارئ الإضافية الصريحة (docs/08 §8) — orders.surge_amount_cents كان عمود راكد،
        // بيتفعّل هنا. صفر لأي طلب مش طوارئ أو إعادة زيارة (مجانية بالكامل أصلاً).
        surgeAmountCents: originalOrder ? 0 : estimate.emergency_surcharge_cents,
        totalAmountCents: originalOrder
          ? 0
          : estimate.estimated_total_cents + estimate.inspection_fee_cents + estimate.emergency_surcharge_cents + addonsTotalCents,
        // لسه UNPAID عمداً حتى لو صفر جنيه — لازم يعدّي بنفس دورة الدفع العادية (collectCash/
        // payWithWallet → settleAndComplete) عشان الطلب يتقفل صح ويوصل COMPLETED، مش يعلق في
        // work_completed للأبد. doubleEntry بمحفظة اتحصّن ضد مبلغ صفر تحديداً لأجل الحالة دي.
        paymentStatus: OrderPaymentStatus.UNPAID,
        placedAt: now,
        sourceChannel: callCenterContext ? OrderSourceChannel.CALL_CENTER : OrderSourceChannel.CUSTOMER_APP,
        createdByAdminUserId: callCenterContext?.adminUserId ?? null,
        // محرك الإنتاجية (docs/06 §3.3-§3.6) — راجع تعليق durationEstimate فوق.
        standardDataId: durationEstimate ? dto.standard_data_id! : null,
        requiredTechnicians: durationEstimate?.assigned_technicians ?? formulaCrewTechnicians,
        requiredAssistants: durationEstimate?.assigned_assistants ?? formulaCrewAssistants,
        estimatedDurationDays: durationEstimate?.estimated_days ?? formulaDurationDays,
        // محرك الإنتاجية الذاتي التعلّم (docs/06 §3.9، migration 0077) — راجع تعليق العمود.
        requestedUnits: durationEstimate ? String(dto.requested_units) : null,
        idempotencyKey: idempotencyKey ?? null,
      });
      await manager.save(order);

      // حجز السلوت ذرّي جوّه نفس الـtransaction بتاعة إنشاء الطلب — لو حد تاني حجزه في نفس
      // اللحظة (سباق حقيقي بين طلبين)، الطلب كله بيترول باك مش يتعمل بلا سلوت فعلي بيشاور عليه.
      if (scheduleSlot) {
        const booked = await this.scheduleService.bookSlot(scheduleSlot.id, order.id, manager);
        if (!booked) {
          throw new ApiException(ErrorCode.VAL_001, 'السلوت ده اتحجز من عميل تاني للتو — اختار سلوت تاني', HttpStatus.CONFLICT);
        }
      }

      // إضافات الكتالوج اللي العميل اختارها بنفسه وقت الحجز — is_customer_approved=true فوراً
      // (مختلف عن مسار awaiting_quote_approval في order-items.service.ts اللي الفني بيقترحه
      // أثناء الشغل ومحتاج موافقة لاحقة).
      if (addons.length > 0) {
        await manager.save(
          addons.map((addon) =>
            manager.create(OrderItem, {
              orderId: order.id,
              itemType: OrderItemType.ADDON,
              referenceId: addon.id,
              nameAr: addon.nameAr,
              quantity: '1',
              unitPriceCents: addon.priceCents,
              totalPriceCents: addon.priceCents,
              isCustomerApproved: true,
              approvedAt: now,
              addedByUserId: userId,
            }),
          ),
        );
      }

      // كود الخصم لازم يتحقق ويتسجّل جوّه نفس الـ transaction دي — order.id لازم يكون موجود
      // الأول (order_id NOT NULL في promo_code_usages)، والقفل الذرّي على صف الكود بيحمي من
      // سباق طلبين بيستخدموا نفس الكود في نفس اللحظة يتجاوزوا الحد الأقصى/الميزانية سوا.
      if (dto.promo_code) {
        const { promoCode, discountCents } = await this.promoCodesService.validateAndApply(
          manager,
          dto.promo_code,
          userId,
          order.id,
          {
            serviceId: service.id,
            zoneId: zone.id,
            totalBeforeDiscountCents: order.totalAmountCents,
            inspectionFeeCents: order.inspectionFeeCents,
            isNewCustomer,
          },
        );
        order.promoCodeId = promoCode.id;
        order.discountAmountCents = discountCents;
        order.totalAmountCents -= discountCents;
        await manager.save(order);
      }

      // خصم العمارة (docs/08 §13، ADR-0003) — نسبة مئوية على الإجمالي قبل الخصم، مفيش جدول
      // usage/حدود زي promo_codes (مفيش حد استخدام شهري بالمعنى ده، بس تتبّع عدد الطلبات
      // للمقارنة بـminimum_monthly_orders من واجهة الأدمن، تفصيل منفصل تمامًا عن الخصم نفسه).
      if (building) {
        const discountCents = Math.round((order.totalAmountCents * Number(building.discountPercentage)) / 100);
        order.discountAmountCents = discountCents;
        order.totalAmountCents -= discountCents;
        await manager.save(order);
      }

      // الضمان الإضافي بيتسعّر بعد خصم الخدمة ثم يُضاف كسطر مستقل. الخطة نفسها اتقرأت من
      // الباك-إند واتحفظت snapshot، لذلك العميل لا يقدر يرسل سعرًا ولا يتأثر الطلب بتعديل لاحق.
      if (optionalWarranty) {
        order.warrantyPriceCents = this.optionalWarrantyPrice(optionalWarranty, order.totalAmountCents);
        order.totalAmountCents += order.warrantyPriceCents;
        await manager.save(order);
      }

      // سياسة إيداع (ADR-0027، docs/08 §42 Phase A.3) — snapshot مبلغ الإيداع بعد كل الخصومات
      // (نفس سبب ترتيب requiresPrepay تحت بالحرف: النسبة بتتحسب على الإجمالي النهائي مش الخام).
      // إعادة الزيارة (originalOrder) وأي إجمالي صفر مستثنيان — مفيش إيداع لمبلغ صفر أصلاً.
      if (!originalOrder && service.depositRequired && order.totalAmountCents > 0) {
        order.depositAmountCents = Math.round((order.totalAmountCents * Number(service.depositPercentage)) / 100);
        await manager.save(order);
      }

      // دفع قبل التوزيع (ADR-0013 §3/§4/§12) — بيتحدد هنا (بعد كل الخصومات، مش وقت إنشاء الصف
      // فوق) عشان لو خصم كامل (كود/عمارة) خلّى الإجمالي صفر، الطلب يتوزّع فورًا زي أي طلب مجاني
      // عادي بدل ما يعلّق PENDING_PAYMENT لمبلغ صفر مالوش معنى يتدفع. الطلب بيتسجّل SEARCHING_TECHNICIAN
      // فوق مبدئيًا؛ لو requiresPrepay صح بيتحدّث هنا لـPENDING_PAYMENT قبل ما history الوحيدة تتسجّل.
      const requiresPrepay = Boolean(requestedPrepayMethod) && order.totalAmountCents > 0;
      if (requiresPrepay) {
        order.orderStatus = OrderStatus.PENDING_PAYMENT;
        await manager.save(order);
      }

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus: null,
          newStatus: order.orderStatus,
          changedByUserId: userId,
          changedByRole: 'customer',
          changeSource: OrderChangeSource.CUSTOMER,
        }),
      );

      // إثبات قبول شروط الدفع (migration 0177) — جوّه نفس transaction الطلب: القبول بيرتبط
      // بالطلب الفعلي (context order)، ولو الطلب فشل مفيش إثبات يتيم.
      for (const versionId of postpaidPolicyVersionIds) {
        await manager.query(
          `INSERT INTO payment_policy_acceptances (policy_version_id, user_id, context_type, context_id)
           VALUES ($1,$2,'order',$3)`,
          [versionId, userId, order.id],
        );
      }

      // ربط المشروع والمرحلة (migration 0179) — المرحلة لا معنى لها من غير مشروع، ولازم تكون
      // تابعة لنفس المشروع المملوك للعميل. الفحص القديم كان يسمح milestone_id منفردة أو مرحلة
      // من مشروع مختلف، فينتج طلب بعلاقات متعارضة لا تظهر صح في غرفة المشروع.
      if (dto.project_id || dto.milestone_id) {
        if (dto.milestone_id && !dto.project_id) {
          throw new ApiException(ErrorCode.VAL_001, 'اختيار مرحلة محتاج تحديد المشروع التابع لها', HttpStatus.BAD_REQUEST);
        }
        if (dto.project_id) {
          const [proj] = await manager.query(
            `SELECT id FROM projects WHERE id = $1 AND customer_id = $2 AND deleted_at IS NULL AND status IN ('active','awaiting_milestone_approval')`,
            [dto.project_id, customerProfile.id],
          );
          if (!proj) throw new ApiException(ErrorCode.VAL_001, 'المشروع غير موجود أو غير نشط', HttpStatus.BAD_REQUEST);
        }
        if (dto.milestone_id) {
          const [ms] = await manager.query(
            `SELECT m.id
             FROM project_milestones m
             JOIN projects p ON p.id = m.project_id
             WHERE m.id = $1 AND m.project_id = $2 AND p.customer_id = $3 AND p.deleted_at IS NULL`,
            [dto.milestone_id, dto.project_id, customerProfile.id],
          );
          if (!ms) throw new ApiException(ErrorCode.VAL_001, 'المرحلة غير موجودة داخل المشروع المحدد', HttpStatus.BAD_REQUEST);
        }
      }
      order.projectId = dto.project_id ?? null;
      order.milestoneId = dto.milestone_id ?? null;

      // "كرّر الحجز ده" (migration 0176) — القالب بيتإنشاء جوّه نفس transaction الطلب (ذرّي:
      // لو إنشاء الطلب فشل مفيش قالب يتيم، ولو القالب فشل الطلب بيترول باك كمان). الموعد الأول
      // للقالب = التكرار الجاي **بعد** الحجز المحجوز فعلاً. الحجز الحالي يظل order_type=standard
      // للتوافق، لكنه يُربط بالقالب ويُسجل كنوبة completed؛ وبكده يظهر في "كل الطلبات" وفي سجل
      // الحجز المتكرر بنفس الهوية بدل ما يبدو كطلب عادي منفصل.
      if (repeatPlanFrequency && order.scheduledAt) {
        const template = await manager.save(
          manager.create(RecurringOrderTemplate, {
            customerId: customerProfile.id,
            serviceId: service.id,
            addressId: address.id,
            bookingMode,
            // تفضيل الفني الفعلي المرتبط بالحجز ده (سلوت/تفضيل صريح) بيتكرر كـ"تفضيل مش ضمان"
            // بنفس دلالات requested_technician_id العادية — لو مش متاح وقت التوليد الطلب المتولّد
            // بيتوزّع عادي زي أي طلب.
            requestedTechnicianId: order.requestedTechnicianId,
            requestedTechnicianCompanyId: dto.requested_technician_company_id ?? null,
            frequency: repeatPlanFrequency,
            fieldValues: dto.field_values ?? null,
            durationHours: order.durationHours,
            scheduledEndAt: order.scheduledEndAt,
            problemDescription: dto.problem_description ?? null,
            // نفس قيد chk_recurring_order_templates_payment_method (card/instapay بس — كاش/محفظة
            // دفعهم بعد الشغل، مالهمش معنى "قبل التوزيع" بيتكرر).
            // القوالب المتكررة الحالية تدعم card/instapay فقط. Fawry يحتاج كودًا مرجعيًا جديدًا
            // لكل نوبة وتدفق إشعار منفصل، لذلك لا نخزن قيمة غير مسموحة في القالب.
            paymentMethod: requestedPrepayMethod === 'fawry_reference' ? null : requestedPrepayMethod ?? null,
            nextRunAt: nextOccurrence(order.scheduledAt, repeatPlanFrequency),
            isActive: true,
          }),
        );
        order.recurringTemplateId = template.id;
        order.recurringOccurrenceAt = order.scheduledAt;
        await manager.save(order);
        await manager.query(
          `INSERT INTO recurring_order_occurrences
             (template_id, scheduled_for, status, attempt_count, completed_at, order_id)
           VALUES ($1, $2, 'completed', 1, now(), $3)`,
          [template.id, order.scheduledAt, order.id],
        );
        template.lastGeneratedOrderId = order.id;
        await manager.save(template);
      }

      return order;
      });
    } catch (err) {
      // سباق حقيقي: نداءين متزامنين بنفس الـidempotency key وصلوا هنا مع بعض (الفحص المبكر
      // قبل الـtransaction لسه ما لقاش حاجة للاتنين، TOCTOU عادي). الفهرس الفريد الجزئي
      // (migration 0139) بيرفض التاني، والـtransaction بتاعته بتترول باك بالكامل — بدل ما
      // نسرّب خطأ DB خام للعميل، نرجّع نفس الطلب اللي الأول عمله فعلاً (نفس فلسفة
      // PaymentsService.payWithWallet() بالحرف).
      if (idempotencyKey && this.isIdempotencyKeyViolation(err)) {
        const existing = await this.orders.findOne({ where: { customerId: customerProfile.id, idempotencyKey } });
        if (existing) return existing;
      }
      throw err;
    }

    // ربط سجل تدقيق تسعير formula (لو الخدمة formula) بالطلب اللي اتأكّد فعلاً — snapshot
    // السعر التاريخي (docs/08 §1، طلب تتبّع السعر النهائي حتى لو الأدمن غيّر القواعد بعدين).
    // بره الـtransaction عمداً — تدقيق مش لازم يفشّل إنشاء الطلب لو فشل، ومحتاج order.id الحقيقي.
    if (estimate.pricing_evaluation_id) {
      await this.pricingEngineService.linkEvaluationToOrder(estimate.pricing_evaluation_id, createdOrder.id);
    }

    // Call Center — تدقيق الإنشاء نيابة عن العميل (Script 4 §37) — بره الـtransaction عمداً
    // (نفس فلسفة linkEvaluationToOrder فوق: تدقيق مش لازم يفشّل إنشاء الطلب لو فشل).
    if (callCenterContext) {
      await this.auditLog.record({
        actorUserId: callCenterContext.adminUserId,
        actorRole: 'admin',
        action: 'order.created_for_customer',
        entityType: 'order',
        entityId: createdOrder.id,
        newValues: { customer_id: customerProfile.id, customer_user_id: userId, service_id: service.id },
        meta: callCenterContext.meta,
      });
    }

    // دفع قبل التوزيع (ADR-0013 §3/§4/§12) — الطلب PENDING_PAYMENT: مفيش توزيع خالص لسه، فمفيش
    // داعي نحسب dispatchDeferredUntil ولا نصدّر ORDER_CREATED_EVENT دلوقتي. التصدير بيحصل لاحقًا
    // (نفس الحدث بالظبط، مع dispatchDeferredUntil محسوبة وقتها) من PaymentsService.emitPaymentConfirmedEvents()
    // بعد ما الدفع (كارت/InstaPay) يتأكد فعليًا — طلب لسه مش مدفوع مش "اتعمل" فعليًا بالمعنى
    // التجاري، ممكن ميتدفعش خالص. باقي أحداث النظام (إشعارات "طلبك اتسجّل"، إحصائيات) هتنتظر برضو.
    if (createdOrder.orderStatus === OrderStatus.PENDING_PAYMENT) {
      return createdOrder;
    }

    // تأجيل بث المطابقة لطلب مجدول "بعيد" (ADR-0009 بند 1-2، P0-9) — بيتحسب هنا بالظبط (مش وقت
    // معالجة الحدث لاحقًا) عشان dto.schedule_slot_id متاح مباشرة هنا؛ requestedTechnicianId على
    // الطلب مش دليل كافي على وجود سلوت صريح (بيتحط من إعادة الزيارة والتفضيل العادي كمان). سلوت
    // الجدولة الصريح (scheduleSlot) مستثنى دايمًا — الفني نفسه أعلن توافره في الوقت ده صراحة.
    const leadHours = await this.settingsService.getNumber('matching.deferred_dispatch_lead_hours', 4);
    const dispatchDeferredUntil = computeDispatchDeferredUntil({
      scheduleSlotBooked: !!scheduleSlot,
      scheduledAt: createdOrder.scheduledAt,
      leadHours,
    });

    // بره الـ transaction عمداً — matching لازم يشتغل على بيانات مؤكّدة (committed) بس. لازم
    // emitAsync (مش emit) هنا تحديدًا: بَقّة حقيقية اتلقطت واتصلحت — emit() عادي بيستدعي
    // الـ listeners من غير ما يستنى الـ promise بتاعهم (fire-and-forget)، يعني create() كانت
    // بترجع للعميل بـ 201 قبل ما OrderDispatchListener يخلّص إنشاء صفوف order_assignments في
    // DB. لو الفني (أو اختبار حي) نادى accept() فوراً بعد استلام رد إنشاء الطلب من غير أي تأخير
    // طبيعي، كان بيرجع "العرض ده مبقاش متاح" رغم إن الطلب لسه بيتوزّع. اتلقطت بـ curl مباشر
    // (نداءين متتاليين من غير أي تأخير) قبل ما نلاقيها كمان في اختبار Dart حي جديد. emitAsync
    // بتستنى كل الـ listeners (بما فيهم OrderDispatchListener) يخلّصوا قبل ما create() ترجع —
    // لطلب فوري/قريب من الموعد ده معناه التوزيع للفنيين المؤهلين خلص فعلاً وقت الرد؛ لطلب "بعيد"
    // (dispatchDeferredUntil موجودة) OrderDispatchListener بيجدول job مؤجّل بدل ما يبث فورًا،
    // فالرد بيرجع بسرعة برضو من غير ما ينتظر بث حقيقي هيحصل بعدين. باقي أحداث النظام (إشعارات،
    // إحصائيات) لسه fire-and-forget عمداً — الاستثناء هنا بس لإن قرار التوزيع/التأجيل ده جزء
    // أساسي من دورة الطلب مش side effect.
    await this.events.emitAsync(ORDER_CREATED_EVENT, new OrderCreatedEvent(createdOrder.id, dispatchDeferredUntil));

    return createdOrder;
  }

  // نفس نمط AdminOrdersService.isUniqueViolation() بالحرف — خطأ Postgres الخام (23505) بيتحوّل
  // لاسترجاع الطلب الأصلي بدل ما يتسرّب كـ500 عام (سباق idempotency-key حقيقي، راجع create() فوق).
  private isIdempotencyKeyViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: unknown }).code === '23505' &&
      'constraint' in err &&
      (err as { constraint: unknown }).constraint === 'idx_orders_customer_idempotency_key'
    );
  }

  // معاينة السعر الحقيقي الكامل قبل تأكيد الحجز (docs/08 §1/§2) — كانت فجوة موثّقة صراحة:
  // apps/customer-app كان بيعرض إما basePriceCents الثابت (نموذج fixed) أو سعر formula خام
  // من غير رسوم الطوارئ/رسوم الفحص أصلاً (نموذج formula)، وأي منهم بلا الإضافات ولا الخصم —
  // رقم غامض ممكن يختلف عن المحصّل فعليًا. الحل: دالة معاينة read-only بتكرر **بالحرف** نفس
  // منطق تحديد المنطقة وحساب السعر في create() فوق (نفس catalogService.estimate() ونفس
  // حساب addonsTotalCents)، من غير أي كتابة/transaction/قفل — مفيش حاجة بتتغيّر في الداتابيز.
  // **قرار موثّق صراحة**: أي تعديل في منطق تسعير create() لازم يتعدّل هنا بالتوازي (نفس فلسفة
  // PromotionsService.previewForOrder() الموجودة من قبل لمعاينة كود الخصم بس).
  async previewPrice(userId: string, dto: PreviewOrderDto): Promise<PreviewOrderResponseDto> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);
    const address = await this.addressesService.findOwnedOrThrow(userId, dto.address_id);
    const service = await this.catalogService.findServiceOrThrow(dto.service_id);
    const optionalWarranty = await this.resolveOptionalWarranty(dto.warranty_plan_id, service.id);

    const bookingMode = dto.booking_mode ?? BookingMode.INDIVIDUAL;
    const bookingModeAllowed =
      bookingMode === BookingMode.INDIVIDUAL
        ? service.allowsIndividual
        : bookingMode === BookingMode.TEAM
          ? service.allowsTeam
          : service.allowsEmergency;
    if (!bookingModeAllowed) {
      throw new ApiException(ErrorCode.VAL_001, 'وضع الحجز ده مش متاح لهذه الخدمة', HttpStatus.BAD_REQUEST);
    }

    if (!address.cityId) {
      throw new ApiException(ErrorCode.ORDR_001, 'العنوان مش مربوط بمدينة', HttpStatus.BAD_REQUEST);
    }
    const [longitude, latitude] = address.location.coordinates;
    const zone = await this.geoService.findZoneForPoint(address.cityId, latitude, longitude);
    if (!zone) {
      throw new ApiException(ErrorCode.ORDR_001, 'الخدمة غير متاحة في منطقتك لسه', HttpStatus.BAD_REQUEST);
    }

    // مضاعف سعر مستوى الفني (docs/08) — نفس منطق create() بالحرف، راجع تعليقها الكامل هناك.
    // سلوت الجدولة بيغلب requested_technician_id لو الاتنين موجودين (نفس أولوية create()).
    const scheduleSlotTechnicianProfile = dto.schedule_slot_id
      ? await this.techniciansService.findByProfileIdOrThrow(
          (await this.scheduleService.findAvailableSlotOrThrow(dto.schedule_slot_id)).technicianId,
        )
      : null;
    const requestedTechnicianProfile = dto.requested_technician_id
      ? await this.techniciansService.findByProfileIdOrThrow(dto.requested_technician_id)
      : null;
    const previewTechnicianLevel = scheduleSlotTechnicianProfile?.currentLevel ?? requestedTechnicianProfile?.currentLevel;
    const previewTechnicianPricingTier = scheduleSlotTechnicianProfile?.pricingTier ?? requestedTechnicianProfile?.pricingTier;

    const estimate = await this.catalogService.estimate(
      service.id,
      zone.id,
      previewTechnicianLevel,
      bookingMode === BookingMode.EMERGENCY,
      dto.field_values,
      previewTechnicianPricingTier,
      dto.duration_hours,
    );
    const addons = await this.catalogService.findAddonsByIds(service.id, dto.addon_ids ?? []);
    const addonsTotalCents = addons.reduce((sum, addon) => sum + addon.priceCents, 0);

    if (dto.promo_code && dto.building_code) {
      throw new ApiException(ErrorCode.VAL_001, 'مينفعش كود خصم وكود عمارة مع بعض', HttpStatus.BAD_REQUEST);
    }

    const subtotalBeforeDiscountCents =
      estimate.estimated_total_cents + estimate.inspection_fee_cents + estimate.emergency_surcharge_cents + addonsTotalCents;

    let discountCents = 0;
    let discountSource: 'promo_code' | 'building' | null = null;
    if (dto.promo_code) {
      const isNewCustomer = await this.customerProfiles.isNewCustomer(customerProfile.id);
      const { discountCents: preview } = await this.promoCodesService.preview(dto.promo_code, userId, {
        serviceId: service.id,
        zoneId: zone.id,
        totalBeforeDiscountCents: subtotalBeforeDiscountCents,
        inspectionFeeCents: estimate.inspection_fee_cents,
        isNewCustomer,
      });
      discountCents = preview;
      discountSource = 'promo_code';
    } else if (dto.building_code) {
      const building = await this.buildingsService.findActiveByCodeOrThrow(dto.building_code);
      discountCents = Math.round((subtotalBeforeDiscountCents * Number(building.discountPercentage)) / 100);
      discountSource = 'building';
    }

    const serviceTotalAfterDiscountCents = subtotalBeforeDiscountCents - discountCents;
    const warrantyPriceCents = this.optionalWarrantyPrice(optionalWarranty, serviceTotalAfterDiscountCents);
    const totalAmountCents = serviceTotalAfterDiscountCents + warrantyPriceCents;
    // سياسة إيداع (ADR-0027، docs/08 §42 Phase A.3) — نفس حساب create() بالحرف (راجع تعليق
    // depositAmountCents هناك). المعاينة لازم تطابق المحصّل الفعلي 100% (نفس مبدأ الملف كله).
    const depositAmountCents = service.depositRequired && totalAmountCents > 0
      ? Math.round((totalAmountCents * Number(service.depositPercentage)) / 100)
      : null;

    return {
      base_price_cents: estimate.estimated_total_cents,
      inspection_fee_cents: estimate.inspection_fee_cents,
      min_price_cents: estimate.min_price_cents,
      max_price_cents: estimate.max_price_cents,
      emergency_surcharge_cents: estimate.emergency_surcharge_cents,
      emergency_sla_minutes: estimate.emergency_sla_minutes,
      addons: addons.map((addon) => ({ id: addon.id, name_ar: addon.nameAr, price_cents: addon.priceCents })),
      addons_total_cents: addonsTotalCents,
      optional_warranty: optionalWarranty
        ? {
            id: optionalWarranty.id,
            name_ar: optionalWarranty.name_ar,
            coverage_months: optionalWarranty.coverage_months,
            price_cents: warrantyPriceCents,
          }
        : null,
      warranty_price_cents: warrantyPriceCents,
      subtotal_before_discount_cents: subtotalBeforeDiscountCents,
      discount_cents: discountCents,
      discount_source: discountSource,
      total_amount_cents: totalAmountCents,
      estimated_duration_days: estimate.estimated_duration_days,
      level_price_multiplier: estimate.level_price_multiplier,
      deposit_amount_cents: depositAmountCents,
      due_now_cents: depositAmountCents ?? totalAmountCents,
      remaining_amount_cents: depositAmountCents !== null ? totalAmountCents - depositAmountCents : null,
    };
  }

  async cancel(userId: string, orderId: string, dto: CancelOrderDto): Promise<Order> {
    const order = await this.findOneOwnedOrThrow(userId, orderId);

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

    // سبب مُختار من القايمة (اختياري) — ممكن يترتب عليه رسوم لو برّه نافذة الإلغاء المجاني.
    // ملحوظة: affects_technician_score مُخزّن بس مش بيأثر فعلياً على quality_score حالياً —
    // القاموس مالوش صيغة محددة لحساب التأثير ده (نفس مبدأ عدم اختراع أرقام مش موجودة في المواصفات).
    let feeCents = 0;
    let cancellationReasonId: string | null = null;
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

  /**
   * إعادة جدولة الطلب لموعد تاني عند نفس الفني (docs/08 §22 بند 9-12) — تحرير السلوت القديم
   * وحجز الجديد ذرّيًا جوّه transaction واحدة (TechnicianScheduleService.rescheduleSlot، بيستخدم
   * bookSlot() الذرّية وراها) — لو السلوت الجديد اتحجز من عميل تاني بينهم، الحجز يفشل والقديم
   * يترجع تلقائيًا (rollback)، صفر حجز مزدوج صامت ممكن يحصل بأي حال.
   */
  /**
   * دقة الوقت (ADR-0031 Slice B) — فحص تعارض حقيقي بدقة ساعة لفني معروف صراحة سلفًا (تفضيل أو
   * سلوت)، لخدمات `requires_precise_schedule=true`. نفس فكرة `DomesticWorkersService.findSchedulingConflict()`
   * القديمة (اتلغت مع بنية الشغالة المنفصلة، ADR-0031) بس معمّمة على `orders.technician_id` لأي
   * فني عادي بدل جدول حجوزات منفصل. مقصورة على `orders` بس — الفني هنا فني عادي، مفيش جدول تاني.
   */
  private async assertNoPreciseScheduleConflict(technicianId: string, startsAt: Date, durationHours: number): Promise<void> {
    const endsAt = new Date(startsAt.getTime() + durationHours * 3_600_000);
    const [conflict] = await this.dataSource.query<{ order_number: string }[]>(
      `SELECT order_number FROM orders
       WHERE technician_id = $1
         AND order_status NOT IN ('cancelled_by_customer', 'cancelled_by_technician', 'cancelled_by_system', 'expired', 'completed', 'refunded')
         AND scheduled_at IS NOT NULL AND duration_hours IS NOT NULL
         AND scheduled_at < $3
         AND (scheduled_at + (duration_hours || ' hours')::interval) > $2
       LIMIT 1`,
      [technicianId, startsAt, endsAt],
    );
    if (conflict) {
      throw new ApiException(
        ErrorCode.VAL_001,
        `الفني ده متعارض مع طلب موجود بالفعل (${conflict.order_number}) في الفترة دي`,
        HttpStatus.CONFLICT,
      );
    }
  }

  async reschedule(userId: string, orderId: string, dto: RescheduleOrderDto): Promise<Order> {
    const order = await this.findOneOwnedOrThrow(userId, orderId);
    return this.rescheduleCore(order, dto.new_slot_id, {
      userId,
      role: 'customer',
      changeSource: OrderChangeSource.CUSTOMER,
    });
  }

  /**
   * إعادة جدولة عامة من الأدمن (Script 4 Part K §42) — بعكس reschedule() فوق (مقصور على العميل
   * صاحب الطلب)، ده لأي طلب بغض النظر عن هوية العميل. استخدام تشغيلي حقيقي: العميل يتصل بخدمة
   * العملاء يطلب تأجيل الموعد، الموظف بينفذها نيابة عنه — بديل عن الدخول على الداتابيز يدويًا.
   * نفس آلية الحجز الذرّي بالحرف (rescheduleCore المشتركة)، الفرق بس هوية المنفّذ + سبب إلزامي
   * للتدقيق (مش مطلوب من العميل نفسه لما بيعيد جدولة طلبه هو).
   */
  async rescheduleByAdmin(adminUserId: string, orderId: string, newSlotId: string, reason: string, meta?: AuditActorMeta): Promise<Order> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
    }
    const previousScheduledAt = order.scheduledAt;
    const updated = await this.rescheduleCore(order, newSlotId, {
      userId: adminUserId,
      role: 'admin',
      changeSource: OrderChangeSource.ADMIN,
      reasonSuffix: ` — سبب: ${reason}`,
    });
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'order.rescheduled_by_admin',
      entityType: 'order',
      entityId: orderId,
      oldValues: { scheduled_at: previousScheduledAt?.toISOString() ?? null },
      newValues: { scheduled_at: updated.scheduledAt?.toISOString() ?? null, reason },
      meta,
    });
    return updated;
  }

  private async rescheduleCore(
    order: Order,
    newSlotId: string,
    actor: { userId: string; role: string; changeSource: OrderChangeSource; reasonSuffix?: string },
  ): Promise<Order> {
    const orderId = order.id;
    if (!RESCHEDULABLE_STATUSES.has(order.orderStatus)) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        `مينفعش تعيد جدولة الطلب والفني في حالة ${order.orderStatus}`,
        HttpStatus.CONFLICT,
      );
    }
    if (!order.technicianId) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب ده مفيهوش فني معيّن لسه', HttpStatus.CONFLICT);
    }

    const currentSlot = await this.scheduleService.findSlotForOrder(orderId);
    if (!currentSlot) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب ده مش مرتبط بموعد محدد أصلاً', HttpStatus.CONFLICT);
    }

    const newSlot = await this.scheduleService.findAvailableSlotOrThrow(newSlotId);
    if (newSlot.technicianId !== order.technicianId) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'السلوت الجديد لازم يكون لنفس الفني المعيّن على الطلب — تغيير الفني نفسه مسار مختلف',
        HttpStatus.BAD_REQUEST,
      );
    }

    const previousScheduledAt = order.scheduledAt;
    const newScheduledAt = new Date(`${newSlot.slotDate}T${newSlot.startTime}Z`);

    await this.dataSource.transaction(async (manager) => {
      const booked = await this.scheduleService.rescheduleSlot(orderId, newSlot.id, manager);
      if (!booked) {
        throw new ApiException(ErrorCode.VAL_001, 'السلوت ده اتحجز من حد تاني لسه، اختار سلوت تاني', HttpStatus.CONFLICT);
      }

      // قفل تشاؤمي + إعادة تحقق تحت القفل قبل الكتابة (docs/08 §22 بند 31-32) — بَقّة حقيقية
      // اتلقطت حية: لو الفني بدأ يتحرّك فعليًا (depart()) في نفس اللحظة، save(order) هنا كان
      // هيكتب كل أعمدة الـobject القديم اللي في الذاكرة (بما فيهم order_status='accepted' القديمة)
      // فوق التغيير الحقيقي، يعني يرجّع الطلب "accepted" كذب رغم إن الفني فعليًا في الطريق.
      // بنجيب نسخة طازة تحت قفل ونكتب scheduled_at عليها هي بس (مش order القديمة).
      const fresh = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();
      if (!fresh || !RESCHEDULABLE_STATUSES.has(fresh.orderStatus)) {
        throw new ApiException(
          ErrorCode.ORDR_003,
          'حالة الطلب اتغيّرت (الفني بدأ يتحرّك مثلاً) — مينفعش تعيد الجدولة دلوقتي',
          HttpStatus.CONFLICT,
        );
      }
      fresh.scheduledAt = newScheduledAt;
      await manager.save(fresh);

      // سجل تاريخ محفوظ (نفس orderStatus قبل وبعد — إعادة الجدولة ماتغيّرش حالة الطلب خالص، بس
      // لازم يتسجّل كتغيير حقيقي مش يختفي بلا أثر).
      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus: fresh.orderStatus,
          newStatus: fresh.orderStatus,
          changedByUserId: actor.userId,
          changedByRole: actor.role,
          changeSource: actor.changeSource,
          reason: `إعادة جدولة — من ${previousScheduledAt?.toISOString() ?? 'بلا موعد'} لـ ${newScheduledAt.toISOString()}${actor.reasonSuffix ?? ''}`,
        }),
      );
    });
    order.scheduledAt = newScheduledAt;

    this.events.emit(
      ORDER_RESCHEDULED_EVENT,
      new OrderRescheduledEvent(order.id, order.orderNumber, order.technicianId, order.customerId, previousScheduledAt, newScheduledAt),
    );

    return order;
  }

  // ── دورة عمل الفني: قبل → في الطريق → وصل → بدأ → خلص ───────────────────

  async findOwnedByTechnicianOrThrow(userId: string, orderId: string): Promise<Order> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    const order = await this.orders.findOne({ where: { id: orderId, technicianId: profile.id } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
    }
    return order;
  }

  /**
   * (docs/08 §31) — للقراءة بس (تفاصيل الطلب + قايمة أعضاء الفريق)، مش لأي فعل تنفيذي. عضو فريق
   * مُضاف (order_team_members، مش قائد الطلب) عنده حق يشوف الطلب دلوقتي — بَقّة حقيقية كانت هنا:
   * findOwnedByTechnicianOrThrow() القديمة كانت بترفض 404 لعضو الفريق نفسه، فمكانش يقدر أصلاً
   * يشوف تفاصيل شغلانة اتضاف ليها. أفعال التنفيذ (depart/arrive/start/complete/cancel) لسه
   * findOwnedByTechnicianOrThrow بس (القائد وحده) — نفس فلسفة "عضو فريق عادي ميقدرش يلغي بنفسه".
   */
  async findVisibleForTechnician(userId: string, orderId: string): Promise<Order> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
    }
    if (order.technicianId === profile.id) {
      return order;
    }
    const [membership] = await this.orders.manager.query<{ id: string }[]>(
      `SELECT id FROM order_team_members WHERE order_id = $1 AND technician_id = $2 LIMIT 1`,
      [orderId, profile.id],
    );
    if (!membership) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
    }
    return order;
  }

  /** "شغلي كعضو فريق" (docs/08 §31) — عكس findActiveForTechnician() بالظبط: طلبات الفني قائدها فيها فني تاني، وهو بس مضاف كعضو. */
  async listTeamAssignedForTechnician(userId: string): Promise<Order[]> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    // استعلام خام لمعرّفات الطلبات بس (بلا hydration) — الجلب الفعلي عبر repository.find() تحت
    // عشان يرجّع كيانات Order مربوطة صح (camelCase)، مش صفوف خام (snake_case) هتكسر toOrderResponseDto.
    const rows = await this.orders.manager.query<{ order_id: string }[]>(
      `SELECT DISTINCT otm.order_id FROM order_team_members otm
       JOIN orders o ON o.id = otm.order_id
       WHERE otm.technician_id = $1 AND o.order_status = ANY($2::order_status[]) AND o.deleted_at IS NULL`,
      [profile.id, ACTIVE_TECHNICIAN_ORDER_STATUSES],
    );
    if (rows.length === 0) return [];
    return this.orders.find({
      where: { id: In(rows.map((r) => r.order_id)) },
      order: { updatedAt: 'DESC' },
    });
  }

  // الحالات اللي الفني يقدر يلغي فيها نفسه — بعد ما الشغل الفعلي يبدأ (in_progress فما بعده)
  // الإلغاء لازم يعدّي من الشكوى مش زرار مباشر (نفس الحد القديم، لسه موجود).
  private static readonly TECHNICIAN_CANCELLABLE_STATUSES = new Set<OrderStatus>([
    OrderStatus.ACCEPTED,
    OrderStatus.TECHNICIAN_ON_WAY,
    OrderStatus.TECHNICIAN_ARRIVED,
  ]);

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
    const order = await this.findOwnedByTechnicianOrThrow(userId, orderId);

    if (!OrdersService.TECHNICIAN_CANCELLABLE_STATUSES.has(order.orderStatus)) {
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
  async technicianCancel(userId: string, orderId: string, dto: CancelOrderAsTechnicianDto): Promise<Order> {
    const order = await this.findOwnedByTechnicianOrThrow(userId, orderId);

    if (!OrdersService.TECHNICIAN_CANCELLABLE_STATUSES.has(order.orderStatus)) {
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
   * العميل بيستخدمها لما طلبه يبقى `awaiting_technician_reselection` (فني لغى طلب كان مختاره
   * بنفسه) — إما يختار فني بديل بعينه (`requested_technician_id`) أو يسيب المطابقة التلقائية
   * تختار. الطلب الأصلي (خدمة/عنوان/موعد) محفوظ بالكامل — مفيش إنشاء طلب جديد.
   */
  async requestRematch(userId: string, orderId: string, dto: RequestRematchDto): Promise<Order> {
    const order = await this.findOneOwnedOrThrow(userId, orderId);
    if (order.orderStatus !== OrderStatus.AWAITING_TECHNICIAN_RESELECTION) {
      throw new ApiException(ErrorCode.ORDR_003, 'الطلب مش في حالة تستني اختيار فني بديل', HttpStatus.CONFLICT);
    }
    if (dto.requested_technician_id) {
      await this.techniciansService.findByProfileIdOrThrow(dto.requested_technician_id);
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
  async findActiveForTechnician(userId: string): Promise<Order | null> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    const now = new Date();
    return this.orders.findOne({
      where: [
        { technicianId: profile.id, orderStatus: In(ACTIVE_TECHNICIAN_ORDER_STATUSES), scheduledAt: IsNull() },
        {
          technicianId: profile.id,
          orderStatus: In(ACTIVE_TECHNICIAN_ORDER_STATUSES),
          scheduledAt: LessThanOrEqual(now),
        },
      ],
      order: { updatedAt: 'DESC' },
    });
  }

  // "الشغل المؤكّد قدامي" (docs/08 §165) — عكس findActiveForTechnician() بالظبط: الطلبات
  // المجدولة اللي اتأكّدت تلقائيًا (autoConfirmScheduledOrder()) بس لسه معاداش موعدها، عشان
  // apps/technician-app يعرضها كقايمة منفصلة ("شغل قادم مؤكّد") مش يخلطها مع "طلبات محتاجة قرارك".
  async findUpcomingConfirmedForTechnician(userId: string): Promise<Order[]> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    const now = new Date();
    return this.orders.find({
      where: {
        technicianId: profile.id,
        orderStatus: In(ACTIVE_TECHNICIAN_ORDER_STATUSES),
        scheduledAt: MoreThan(now),
      },
      order: { scheduledAt: 'ASC' },
    });
  }

  /** مصدر واحد لكل انتقالات الفني — بتحترم الـ state machine وبتسجل التاريخ زي أي انتقال تاني. */
  private async transitionAsTechnician(
    userId: string,
    orderId: string,
    to: OrderStatus,
    applyTimestamp: (order: Order, now: Date) => void,
  ): Promise<Order> {
    const order = await this.findOwnedByTechnicianOrThrow(userId, orderId);

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
    if (
      to === OrderStatus.IN_PROGRESS &&
      (order.bookingMode === BookingMode.TEAM || ((order.requiredTechnicians ?? 1) > 1 || (order.requiredAssistants ?? 0) > 0))
    ) {
      const crew = await this.orderTeamService.getCrewComposition(order.id, order);
      if (!crew.crewComplete) {
        throw new ApiException(
          ErrorCode.ORDR_005,
          `الطاقم لسه ناقص — محتاج ${crew.missingTechnicians} فني و${crew.missingAssistants} مساعد قبل ما تقدر تبدأ الشغل`,
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

  // ── زيارة فاشلة/عدم حضور (docs/08 §22 بند 3-6) ──────────────────────────

  /**
   * الفني بيبلّغ إن الزيارة فشلت — العميل مش موجود خالص، أو رفض شغل ضروري لإتمام الطلب صح.
   * "الفني بيوقف، مفيش شغل غير مصرّح، مفيش completed كاذبة" — الطلب بيتحول DISPUTED (نفس حالة
   * النزاع الموجودة بالفعل) وبيوديه لمراجعة أدمن حقيقية عبر resolveFailedVisit تحت، مش قرار نهائي
   * فوري بيصدّق طرف واحد أعمى.
   */
  async reportFailedVisit(user: JwtPayload, orderId: string, dto: ReportFailedVisitDto): Promise<Order> {
    const order = await this.findOwnedByTechnicianOrThrow(user.sub, orderId);

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
      const newScheduledAt = new Date(`${newSlot.slotDate}T${newSlot.startTime}Z`);
      await this.dataSource.transaction(async (manager) => {
        const fresh = await this.lockDisputedOrderForUpdate(manager, orderId, order.orderNumber);
        const booked = await this.scheduleService.rescheduleSlot(orderId, newSlot.id, manager);
        if (!booked) {
          throw new ApiException(ErrorCode.VAL_001, 'السلوت ده اتحجز من حد تاني لسه، اختار سلوت تاني', HttpStatus.CONFLICT);
        }
        fresh.orderStatus = OrderStatus.ACCEPTED;
        fresh.scheduledAt = newScheduledAt;
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
    const order = await this.findOneOwnedOrThrow(userId, orderId);

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
    const order = await this.findOwnedByTechnicianOrThrow(user.sub, orderId);

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
