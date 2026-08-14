import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, In, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { ORDER_CREATED_EVENT, OrderCreatedEvent } from '../../common/events/order-created.event';
import { ORDER_REMATCH_REQUESTED_EVENT, OrderRematchRequestedEvent } from '../../common/events/order-rematch-requested.event';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { TECHNICIAN_ORDER_CANCELLED_EVENT, TechnicianOrderCancelledEvent } from '../../common/events/technician-order-cancelled.event';
import { BuildingsService } from '../buildings/buildings.service';
import { AddressesService } from '../customers/addresses.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CatalogService } from '../catalog/catalog.service';
import { GeoService } from '../geo/geo.service';
import { PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from '../payments/entities/wallet.entity';
import { WalletTxType } from '../payments/entities/wallet-transaction.entity';
import { PaymentsService } from '../payments/payments.service';
import { WalletsService } from '../payments/wallets.service';
import { SettingsService } from '../settings/settings.service';
import { TechnicianTeamRole } from '../technicians/entities/technician-profile.entity';
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
import { TechnicianCancellationPolicyResponseDto } from './dto/technician-cancellation-policy-response.dto';
import { CancellationAppliesTo, CancellationReason } from './entities/cancellation-reason.entity';
import { BookingMode, Order, OrderPaymentStatus, OrderSourceChannel, OrderStatus, OrderType } from './entities/order.entity';
import { OrderItem, OrderItemType } from './entities/order-item.entity';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';
import { CancellationRecoveryAction, TechnicianOrderCancellation } from './entities/technician-order-cancellation.entity';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, CUSTOMER_CANCELLABLE_STATUSES, canTransition } from './order-state-machine';
import { computeDispatchDeferredUntil } from './deferred-dispatch.util';
import { PromoCodesService } from '../promotions/promo-codes.service';

const CANCELLATION_FREE_WINDOW_FALLBACK_MINUTES = 5;
// سياسة إلغاء الفني (docs/10) — fallback بس، المصدر الحقيقي إعدادات cancellation.* (migration 0070).
const TECHNICIAN_CANCEL_WINDOW_MINUTES_FALLBACK = 10;
const TECHNICIAN_CANCEL_MIN_MINUTES_BEFORE_SCHEDULED_FALLBACK = 60;
// أدوار الفريق اللي تقدر تلغي طلب "اعتماد" (فريق) بنفسها من غير إذن — عضو عادي (worker) لازم
// يعدّي من مديره/المالك، إلا لو cancellation.team_workers_can_self_cancel مفعّل.
const TEAM_SELF_CANCEL_ALLOWED_ROLES = new Set<TechnicianTeamRole>([
  TechnicianTeamRole.INDEPENDENT,
  TechnicianTeamRole.OWNER,
  TechnicianTeamRole.MANAGER,
]);

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(TechnicianOrderCancellation)
    private readonly technicianOrderCancellations: Repository<TechnicianOrderCancellation>,
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
    private readonly events: EventEmitter2,
  ) {}

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

  async create(userId: string, dto: CreateOrderDto): Promise<Order> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);
    const address = await this.addressesService.findOwnedOrThrow(userId, dto.address_id);
    const service = await this.catalogService.findServiceOrThrow(dto.service_id);

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

    // مضاعف سعر مستوى الفني (docs/08 — "قرار عمل: السعر النهائي معروف قبل التأكيد") — بيتطبّق
    // بس لو الفني معروف صراحة وقت الحجز (اختيار مباشر أو سلوت جدولة)، مش لو العميل سايب المطابقة
    // تختار (technicianLevel=undefined يبقى مضاعف=1 داخل estimate()، زي ما كان بالظبط). سلوت
    // الجدولة بيغلب requested_technician_id لو الاتنين موجودين (نفس أولوية اختيار الفني تحت).
    const scheduleSlotTechnicianProfile = scheduleSlot
      ? await this.techniciansService.findByProfileIdOrThrow(scheduleSlot.technicianId)
      : null;
    const knownTechnicianLevel = scheduleSlotTechnicianProfile?.currentLevel ?? requestedTechnicianProfile?.currentLevel;

    const estimate = await this.catalogService.estimate(
      service.id,
      zone.id,
      knownTechnicianLevel,
      bookingMode === BookingMode.EMERGENCY,
      dto.field_values,
    );
    const addons = await this.catalogService.findAddonsByIds(service.id, dto.addon_ids ?? []);
    const addonsTotalCents = addons.reduce((sum, addon) => sum + addon.priceCents, 0);

    // محرك الإنتاجية (docs/06 §3.3-§3.6) — قرار عمل من المالك: القيم المحسوبة هنا بتتسجّل
    // snapshot على الطلب نفسه (مش مجرد معاينة زي POST /services/:id/estimate-duration)، عشان
    // تفضل ظاهرة لفريق العمليات/الفني حتى لو الأدمن غيّر service_standard_data بعدين.
    let durationEstimate: Awaited<ReturnType<CatalogService['estimateDuration']>> | null = null;
    if (dto.standard_data_id && dto.requested_units) {
      durationEstimate = await this.catalogService.estimateDuration(service.id, dto.standard_data_id, dto.requested_units);
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

    const order = await this.dataSource.transaction(async (manager) => {
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
        problemDescription: dto.problem_description ?? null,
        customerNotes: dto.customer_notes ?? null,
        // سلوت الجدولة (لو اتحجز) بيحدد الموعد المطلوب فعليًا — أدق من dto.scheduled_at الحر
        // (تاريخ/وقت السلوت نفسه اللي الفني أعلن عنه، UTC مباشرة زي باقي أوقات المشروع).
        scheduledAt: scheduleSlot
          ? new Date(`${scheduleSlot.slotDate}T${scheduleSlot.startTime}Z`)
          : dto.scheduled_at
            ? new Date(dto.scheduled_at)
            : null,
        // إعادة الزيارة بتفضّل نفس الفني الأصلي دايماً، وسلوت الجدولة (لو اتحجز) بيحدد فني
        // السلوت نفسه — requested_technician_id بتاع الـ dto بيتجاهَل هنا عمداً في الحالتين.
        requestedTechnicianId: originalOrder
          ? originalOrder.technicianId
          : scheduleSlot
            ? scheduleSlot.technicianId
            : (dto.requested_technician_id ?? null),
        parentOrderId: originalOrder ? originalOrder.id : null,
        buildingId: building ? building.id : null,
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
        sourceChannel: OrderSourceChannel.CUSTOMER_APP,
        // محرك الإنتاجية (docs/06 §3.3-§3.6) — راجع تعليق durationEstimate فوق.
        standardDataId: durationEstimate ? dto.standard_data_id! : null,
        requiredTechnicians: durationEstimate?.assigned_technicians ?? null,
        requiredAssistants: durationEstimate?.assigned_assistants ?? null,
        estimatedDurationDays: durationEstimate?.estimated_days ?? null,
        // محرك الإنتاجية الذاتي التعلّم (docs/06 §3.9، migration 0077) — راجع تعليق العمود.
        requestedUnits: durationEstimate ? String(dto.requested_units) : null,
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

      return order;
    });

    // ربط سجل تدقيق تسعير formula (لو الخدمة formula) بالطلب اللي اتأكّد فعلاً — snapshot
    // السعر التاريخي (docs/08 §1، طلب تتبّع السعر النهائي حتى لو الأدمن غيّر القواعد بعدين).
    // بره الـtransaction عمداً — تدقيق مش لازم يفشّل إنشاء الطلب لو فشل، ومحتاج order.id الحقيقي.
    if (estimate.pricing_evaluation_id) {
      await this.pricingEngineService.linkEvaluationToOrder(estimate.pricing_evaluation_id, order.id);
    }

    // دفع قبل التوزيع (ADR-0013 §3/§4/§12) — الطلب PENDING_PAYMENT: مفيش توزيع خالص لسه، فمفيش
    // داعي نحسب dispatchDeferredUntil ولا نصدّر ORDER_CREATED_EVENT دلوقتي. التصدير بيحصل لاحقًا
    // (نفس الحدث بالظبط، مع dispatchDeferredUntil محسوبة وقتها) من PaymentsService.emitPaymentConfirmedEvents()
    // بعد ما الدفع (كارت/InstaPay) يتأكد فعليًا — طلب لسه مش مدفوع مش "اتعمل" فعليًا بالمعنى
    // التجاري، ممكن ميتدفعش خالص. باقي أحداث النظام (إشعارات "طلبك اتسجّل"، إحصائيات) هتنتظر برضو.
    if (order.orderStatus === OrderStatus.PENDING_PAYMENT) {
      return order;
    }

    // تأجيل بث المطابقة لطلب مجدول "بعيد" (ADR-0009 بند 1-2، P0-9) — بيتحسب هنا بالظبط (مش وقت
    // معالجة الحدث لاحقًا) عشان dto.schedule_slot_id متاح مباشرة هنا؛ requestedTechnicianId على
    // الطلب مش دليل كافي على وجود سلوت صريح (بيتحط من إعادة الزيارة والتفضيل العادي كمان). سلوت
    // الجدولة الصريح (scheduleSlot) مستثنى دايمًا — الفني نفسه أعلن توافره في الوقت ده صراحة.
    const leadHours = await this.settingsService.getNumber('matching.deferred_dispatch_lead_hours', 4);
    const dispatchDeferredUntil = computeDispatchDeferredUntil({
      scheduleSlotBooked: !!scheduleSlot,
      scheduledAt: order.scheduledAt,
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
    await this.events.emitAsync(ORDER_CREATED_EVENT, new OrderCreatedEvent(order.id, dispatchDeferredUntil));

    return order;
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

    const estimate = await this.catalogService.estimate(
      service.id,
      zone.id,
      previewTechnicianLevel,
      bookingMode === BookingMode.EMERGENCY,
      dto.field_values,
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

    return {
      base_price_cents: estimate.estimated_total_cents,
      inspection_fee_cents: estimate.inspection_fee_cents,
      min_price_cents: estimate.min_price_cents,
      max_price_cents: estimate.max_price_cents,
      emergency_surcharge_cents: estimate.emergency_surcharge_cents,
      emergency_sla_minutes: estimate.emergency_sla_minutes,
      addons: addons.map((addon) => ({ id: addon.id, name_ar: addon.nameAr, price_cents: addon.priceCents })),
      addons_total_cents: addonsTotalCents,
      subtotal_before_discount_cents: subtotalBeforeDiscountCents,
      discount_cents: discountCents,
      discount_source: discountSource,
      total_amount_cents: subtotalBeforeDiscountCents - discountCents,
      estimated_duration_days: estimate.estimated_duration_days,
      level_price_multiplier: estimate.level_price_multiplier,
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
    await this.dataSource.transaction(async (manager) => {
      order.orderStatus = OrderStatus.CANCELLED_BY_CUSTOMER;
      order.cancelledAt = new Date();
      order.cancelledByUserId = userId;
      order.cancellationReasonId = cancellationReasonId;
      order.cancellationFeeCents = feeCents;
      await manager.save(order);

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: OrderStatus.CANCELLED_BY_CUSTOMER,
          changedByUserId: userId,
          changedByRole: 'customer',
          changeSource: OrderChangeSource.CUSTOMER,
          reason: dto.reason ?? null,
        }),
      );

      // رسوم الإلغاء بتتحصّل جوّه نفس الـ transaction — "الطلب اتلغى بس الرسوم متحصلتش" ميحصلش،
      // نفس فلسفة settleAndComplete في payments. allowNegativeBalance:true لأنها عقوبة مش دفع
      // اختياري (نفس نمط تعويض الشكاوى في support.service.ts).
      if (feeCents > 0) {
        const customerWallet = await this.walletsService.getOrCreateWallet(userId, WalletOwnerType.CUSTOMER);
        const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);
        await this.walletsService.doubleEntry(
          {
            fromWalletId: customerWallet.id,
            toWalletId: platformWallet.id,
            amountCents: feeCents,
            transactionType: WalletTxType.PENALTY,
            referenceType: 'order',
            referenceId: order.id,
            descriptionAr: `رسوم إلغاء طلب ${order.orderNumber}`,
            allowNegativeBalance: true,
          },
          manager,
        );
      }
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
    if (order.paymentStatus === OrderPaymentStatus.PAID) {
      try {
        await this.paymentsService.refundCancelledPrepaidOrder(
          order.id,
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
            entityId: order.id,
            newValues: { order_number: order.orderNumber, error: err instanceof Error ? err.message : String(err) },
          })
          .catch(() => {});
      }
    }

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

  /** هل عضو الفريق ده مسموحله يلغي طلب "اعتماد" (فريق) بنفسه — مالك/مدير دايمًا، عضو عادي بس لو إعداد صريح مفعّل. */
  private async canSelfCancelTeamOrder(teamRole: TechnicianTeamRole): Promise<boolean> {
    if (TEAM_SELF_CANCEL_ALLOWED_ROLES.has(teamRole)) return true;
    return this.settingsService.getBoolean('cancellation.team_workers_can_self_cancel', false);
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

    if (order.bookingMode === BookingMode.TEAM) {
      const technicianProfile = await this.techniciansService.findByUserIdOrThrow(userId);
      if (!(await this.canSelfCancelTeamOrder(technicianProfile.teamRole))) {
        return { can_cancel: false, reason_if_not: 'مينفعش تلغي الطلب ده بنفسك — لازم يعدّي من مدير الفريق', window_expires_at: null };
      }
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
    const technicianProfile = await this.techniciansService.findByUserIdOrThrow(userId);

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

    // صلاحيات الفريق/الشركة — عضو عادي (worker) ميقدرش يلغي طلب "اعتماد" كامل إلا لو الباك-إند
    // بيصرّح بكده صراحة (نفس مبدأ المالك). الفني المستقل/المالك/المدير مسموحلهم دايمًا.
    if (order.bookingMode === BookingMode.TEAM && !(await this.canSelfCancelTeamOrder(technicianProfile.teamRole))) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'مينفعش تلغي الطلب ده بنفسك — لازم يعدّي من مدير الفريق أو الدعم',
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
          technicianId: technicianProfile.id,
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
        const technicianWallet = await this.walletsService.getOrCreateWallet(technicianProfile.userId, WalletOwnerType.TECHNICIAN);
        const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);
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

      order.orderStatus = lockedOrder.orderStatus;
      order.technicianId = lockedOrder.technicianId;
      order.assignedAt = lockedOrder.assignedAt;
      order.requestedTechnicianId = lockedOrder.requestedTechnicianId;
    });

    // حدث audit كامل — بيظهر تلقائيًا في /audit-log الموجودة في apps/admin، صفر شاشة جديدة.
    await this.auditLog.record({
      actorUserId: userId,
      actorRole: 'technician',
      action: 'order.technician_cancelled',
      entityType: 'order',
      entityId: order.id,
      newValues: {
        order_number: order.orderNumber,
        cancellation_reason_id: cancellationReason.id,
        reason_text: dto.reason ?? null,
        elapsed_seconds_after_acceptance: elapsedSecondsAfterAcceptance,
        within_policy_window: true,
        booking_mode: order.bookingMode,
        recovery_action: recoveryAction,
        fee_cents: feeCents,
      },
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
  async findActiveForTechnician(userId: string): Promise<Order | null> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    return this.orders.findOne({
      where: { technicianId: profile.id, orderStatus: In(ACTIVE_TECHNICIAN_ORDER_STATUSES) },
      order: { updatedAt: 'DESC' },
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

    const previousStatus = order.orderStatus;
    await this.dataSource.transaction(async (manager) => {
      const now = new Date();
      order.orderStatus = to;
      applyTimestamp(order, now);
      await manager.save(order);

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: to,
          changedByUserId: userId,
          changedByRole: 'technician',
          changeSource: OrderChangeSource.TECHNICIAN,
        }),
      );
    });

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(order.id, order.orderNumber, previousStatus, to, order.customerId, order.technicianId),
    );

    return order;
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
