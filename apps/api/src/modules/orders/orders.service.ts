import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { JwtPayload } from '../auth/types/authenticated-request';
import { BuildingsService } from '../buildings/buildings.service';
import { AddressesService } from '../customers/addresses.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CatalogService } from '../catalog/catalog.service';
import { GeoService } from '../geo/geo.service';
import { PaymentsService } from '../payments/payments.service';
import { WalletsService } from '../payments/wallets.service';
import { SettingsService } from '../settings/settings.service';
import { SupportService } from '../support/support.service';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianCompaniesService } from '../technicians/technician-companies.service';
import { TechnicianScheduleService } from '../technicians/technician-schedule.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { CommissionBaseService } from '../pricing/commission-base.service';
import { CancellationReasonsService } from './cancellation-reasons.service';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { ContinueWorkAnotherDayDto } from './dto/continue-work-another-day.dto';
import { CancelOrderAsTechnicianDto } from './dto/cancel-order-as-technician.dto';
import { RequestRematchDto } from './dto/request-rematch.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { PreviewOrderDto } from './dto/preview-order.dto';
import { PreviewOrderResponseDto } from './dto/preview-order-response.dto';
import { ReportFailedVisitDto } from './dto/report-failed-visit.dto';
import { ReportCashNotReceivedDto } from './dto/report-cash-not-received.dto';
import { RescheduleOrderDto } from './dto/reschedule-order.dto';
import { CreateTechnicianRescheduleRequestDto } from './dto/create-technician-reschedule-request.dto';
import { ResolveFailedVisitDto } from './dto/resolve-failed-visit.dto';
import { ResolveCashDisputeDto } from './dto/resolve-cash-dispute.dto';
import { TechnicianCancellationPolicyResponseDto } from './dto/technician-cancellation-policy-response.dto';
import {
  Order,
  
  OrderSourceChannel,
} from './entities/order.entity';
import { OrderMedia } from './entities/order-media.entity';
import { OrderCustomerNotice } from './entities/order-customer-notice.entity';
import { OrderQueriesService } from './order-queries.service';
// التعريفات دي بقت في شريحة إعادة الجدولة (تدقيق A-1) — بتتصدّر من هنا كمان عشان أي مستورد
// قديم يفضل شغّال بلا تغيير.
export {
  type OrderRescheduleRequestResponse,
  type OrderRescheduleRequestStatus,
} from './order-reschedule.service';
import { OrderCancellationService } from './order-cancellation.service';
import { OrderCreationService } from './order-creation.service';
import { OrderDisputeService } from './order-dispute.service';
import { OrderTechnicianOpsService } from './order-technician-ops.service';
import { OrderRescheduleService, type OrderRescheduleRequestResponse } from './order-reschedule.service';
import { OrderTeamService } from './order-team.service';
import { CrewShortageEscalationService } from './crew-shortage-escalation.service';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianOrderCancellation } from './entities/technician-order-cancellation.entity';
import { PromoCodesService } from '../promotions/promo-codes.service';
import {
} from './booking-match-context';

/** تسميات عربية لحقول بصمة الحجز — عشان رسالة الرفض تقول للعميل الحقل بلغته مش باسمه التقني. */
// سياسة إلغاء الفني (docs/10) — fallback بس، المصدر الحقيقي إعدادات cancellation.* (migration 0070).



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
    // ADR-0037 — آخر بند عمدًا، نفس سبب orderTeamService فوقه بالحرف: أقل بلاست-رديوس ممكن على
    // الاختبارات الكتير اللي بتبني OrdersService بـpositional args (append واحد بس في الآخر).
    private readonly commissionBaseService: CommissionBaseService,
    // ADR-0064 §1 — التصعيد الفوري لحظة ما نقص الطاقم يمنع الفني من البدء. `@Optional()` عمدًا:
    // عشرات السبيكات القديمة بتبني `OrdersService` بـpositional args، والبوابة نفسها بتفضل
    // شغّالة من غيره (الفرق إن الإدارة مش هتتبلّغ) — فمفيش سلوك بيتغيّر بصمت في الإنتاج، والـ
    // module بيحقنه فعليًا. اختبار حي بيثبت إن التصعيد بيحصل بالفعل في المسار الحقيقي.
    @Optional() private readonly crewShortageEscalation?: CrewShortageEscalationService,
    // ADR-0065 §5 — إعادة فحص أهلية الفني المقفول لحظة التأكيد بنفس بوابة المطابقة (مش نسخة
    // تانية من الشروط). `@Optional()` لنفس سبب اللي فوقه بالحرف؛ الفرق إن غيابه بيخلي القفل
    // يتأكد من التذكرة بس بدل التذكرة + الفني، والاختبار الحي بيثبت إن المسار الحقيقي بيحقنه.
    @Optional() private readonly assignmentGuard?: TechnicianAssignmentGuardService,
  ) {}

  private queriesInstance: OrderQueriesService | null = null;

  /**
   * شريحة القراءات (تدقيق A-1) — **مبنيّة داخليًا مش محقونة**، وده مقصود.
   *
   * حقنها كـparameter تاني وعشرين كان هيكسر ٢٥ spec بتبني `OrdersService` بوسائط ترتيبية،
   * ويضيف بند تاني لنفس القايمة اللي التقسيم موجود عشان يقصّرها. الشريحة بتاخد نفس
   * الاعتماديات الأربعة الموجودة هنا أصلاً، فبناؤها هنا **صفر معلومة جديدة**.
   *
   * كسول (`??=`) عشان الـspecs اللي بتمرّر `{} as never` لاعتماديات مش مستخدمة في مسارها
   * ماتدفعش تكلفة بناء حاجة مش هتتنادى.
   */
  private get queries(): OrderQueriesService {
    return (this.queriesInstance ??= new OrderQueriesService(
      this.orders,
      this.dataSource,
      this.customerProfiles,
      this.techniciansService,
    ));
  }

  private rescheduleFlowInstance: OrderRescheduleService | null = null;

  /**
   * شريحة إعادة الجدولة (تدقيق A-1، شريحة ٢-ب) — مبنيّة داخليًا لنفس سبب `queries` بالحرف:
   * حقنها كان هيضيف اعتمادية جديدة لقايمة الـ٢٥ اللي التقسيم موجود عشان يقصّرها.
   *
   * الفلو ده محتاج **١١** اعتمادية من الـ٢٥ الموجودة هنا — كلها متمرّرة صريحة ومسمّاة تحت،
   * فعقد الشريحة مقروء من غير قراءة جسمها.
   */
  private get rescheduleFlow(): OrderRescheduleService {
    return (this.rescheduleFlowInstance ??= new OrderRescheduleService(
      this.orders,
      this.dataSource,
      this.queries,
      this.customerProfiles,
      this.techniciansService,
      this.scheduleService,
      this.settingsService,
      this.geoService,
      this.addressesService,
      this.auditLog,
      this.events,
    ));
  }

  private disputeFlowInstance: OrderDisputeService | null = null;

  /**
   * شريحة النزاعات (تدقيق A-1، شريحة ٣) — زيارة فاشلة + نزاع تسليم كاش. ٩ اعتماديات من الـ٢٥.
   * نفس نمط `queries`/`rescheduleFlow` بالحرف.
   */
  private get disputeFlow(): OrderDisputeService {
    return (this.disputeFlowInstance ??= new OrderDisputeService(
      this.orders,
      this.dataSource,
      this.queries,
      this.scheduleService,
      this.paymentsService,
      this.supportService,
      this.settingsService,
      this.auditLog,
      this.events,
    ));
  }

  private technicianOpsInstance: OrderTechnicianOpsService | null = null;

  /**
   * شريحة عمليات الفني (تدقيق A-1، شريحة ٤) — دورة التنفيذ + التمديد + الإلغاء + طلب استبدال.
   * الاعتماديتان `@Optional()` بتتمرّرا زي ما هما: غيابهما بيقلّل السلوك مش بيكسره، وده قرار
   * موثّق من قبل التقسيم.
   */
  private get technicianOps(): OrderTechnicianOpsService {
    return (this.technicianOpsInstance ??= new OrderTechnicianOpsService(
      this.orderMedia,
      this.dataSource,
      this.queries,
      this.customerProfiles,
      this.techniciansService,
      this.cancellationReasonsService,
      this.walletsService,
      this.settingsService,
      this.orderTeamService,
      this.auditLog,
      this.events,
      this.crewShortageEscalation,
      this.assignmentGuard,
    ));
  }

  private creationFlowInstance: OrderCreationService | null = null;

  /**
   * شريحة الإنشاء والتسعير (تدقيق A-1، شريحة ٦ والأخيرة). ١٧ اعتمادية — أكتر من أي شريحة،
   * وده **مش عيب فيها**: إنشاء الطلب هو النقطة اللي بيتلاقى فيها كل النظام مرة واحدة (عنوان،
   * كتالوج، تسعير، خصم، نطاق، جدولة، ضمان). الفرق إنها بقت **بتقول محتاجة إيه بالاسم** بدل ما
   * تكون بند وسط ٢٥ اعتمادية بتخدم ست فلوهات.
   */
  private get creationFlow(): OrderCreationService {
    return (this.creationFlowInstance ??= new OrderCreationService(
      this.orders,
      this.dataSource,
      this.customerProfiles,
      this.addressesService,
      this.catalogService,
      this.geoService,
      this.techniciansService,
      this.technicianCompaniesService,
      this.scheduleService,
      this.pricingEngineService,
      this.promoCodesService,
      this.buildingsService,
      this.settingsService,
      this.commissionBaseService,
      this.auditLog,
      this.events,
      this.assignmentGuard,
    ));
  }

  private cancellationFlowInstance: OrderCancellationService | null = null;

  /** شريحة إلغاء العميل (تدقيق A-1، شريحة ٥) — ٩ اعتماديات. */
  private get cancellationFlow(): OrderCancellationService {
    return (this.cancellationFlowInstance ??= new OrderCancellationService(
      this.dataSource,
      this.queries,
      this.cancellationReasonsService,
      this.promoCodesService,
      this.walletsService,
      this.paymentsService,
      this.settingsService,
      this.auditLog,
      this.events,
    ));
  }

  create(
    userId: string,
    dto: CreateOrderDto,
    recurringIdentity?: { templateId: string; scheduledFor: Date },
    callCenterContext?: { adminUserId: string; meta?: AuditActorMeta },
    idempotencyKey?: string,
    sourceChannel: OrderSourceChannel = OrderSourceChannel.CUSTOMER_APP,
  ): Promise<Order> {
    return this.creationFlow.create(userId, dto, recurringIdentity, callCenterContext, idempotencyKey, sourceChannel);
  }

  previewPrice(userId: string, dto: PreviewOrderDto): Promise<PreviewOrderResponseDto> {
    return this.creationFlow.previewPrice(userId, dto);
  }

  cancel(userId: string, orderId: string, dto: CancelOrderDto): Promise<Order> {
    return this.cancellationFlow.cancel(userId, orderId, dto);
  }


  findAllForCustomerUser(userId: string): Promise<Order[]> {
    return this.queries.findAllForCustomerUser(userId);
  }

  listCustomerNotices(orderId: string): Promise<OrderCustomerNotice[]> {
    return this.queries.listCustomerNotices(orderId);
  }

  findOneOwnedOrThrow(userId: string, orderId: string): Promise<Order> {
    return this.queries.findOneOwnedOrThrow(userId, orderId);
  }



  reschedule(userId: string, orderId: string, dto: RescheduleOrderDto): Promise<Order> {
    return this.rescheduleFlow.reschedule(userId, orderId, dto);
  }

  listRescheduleOptionsForCustomer(userId: string, orderId: string): Promise<{ date: string; available: boolean }[]> {
    return this.rescheduleFlow.listRescheduleOptionsForCustomer(userId, orderId);
  }

  requestRescheduleByTechnician(
    userId: string,
    orderId: string,
    dto: CreateTechnicianRescheduleRequestDto,
  ): Promise<OrderRescheduleRequestResponse> {
    return this.rescheduleFlow.requestRescheduleByTechnician(userId, orderId, dto);
  }

  listRescheduleRequestsForCustomer(userId: string, orderId: string): Promise<OrderRescheduleRequestResponse[]> {
    return this.rescheduleFlow.listRescheduleRequestsForCustomer(userId, orderId);
  }

  listRescheduleRequestsForTechnician(userId: string, orderId: string): Promise<OrderRescheduleRequestResponse[]> {
    return this.rescheduleFlow.listRescheduleRequestsForTechnician(userId, orderId);
  }

  resolveTechnicianRescheduleRequest(
    userId: string,
    orderId: string,
    requestId: string,
    decision: 'approved' | 'rejected',
  ): Promise<{ request: OrderRescheduleRequestResponse; order: Order }> {
    return this.rescheduleFlow.resolveTechnicianRescheduleRequest(userId, orderId, requestId, decision);
  }

  rescheduleByAdmin(
    adminUserId: string,
    orderId: string,
    target: { newSlotId?: string; newScheduledAt?: string; newScheduledEndAt?: string },
    reason: string,
    meta?: AuditActorMeta,
  ): Promise<Order> {
    return this.rescheduleFlow.rescheduleByAdmin(adminUserId, orderId, target, reason, meta);
  }

  listRescheduleOptions(orderId: string, days = 14): Promise<{ date: string; available: boolean }[]> {
    return this.rescheduleFlow.listRescheduleOptions(orderId, days);
  }


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

  private async insertDurableInAppNotification(
    manager: EntityManager,
    input: { userId: string; notificationType: string; titleAr: string; bodyAr: string; orderId: string; deepLink: string },
  ): Promise<void> {
    await manager.query(
      `INSERT INTO notifications
         (user_id, notification_type, channel, title_ar, body_ar, deep_link,
          reference_type, reference_id, delivery_status, sent_at)
       VALUES ($1, $2, 'in_app', $3, $4, $5, 'order', $6, 'sent', now())`,
      [input.userId, input.notificationType, input.titleAr, input.bodyAr, input.deepLink, input.orderId],
    );
  }

  // ── دورة عمل الفني: قبل → في الطريق → وصل → بدأ → خلص ───────────────────

  findOwnedByTechnicianOrThrow(userId: string, orderId: string): Promise<Order> {
    return this.queries.findOwnedByTechnicianOrThrow(userId, orderId);
  }

  findVisibleForTechnician(userId: string, orderId: string): Promise<Order> {
    return this.queries.findVisibleForTechnician(userId, orderId);
  }

  listTeamAssignedForTechnician(userId: string): Promise<Order[]> {
    return this.queries.listTeamAssignedForTechnician(userId);
  }

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

  getTechnicianCancellationPolicy(userId: string, orderId: string): Promise<TechnicianCancellationPolicyResponseDto> {
    return this.technicianOps.getTechnicianCancellationPolicy(userId, orderId);
  }

  continueWorkAnotherDay(
    userId: string,
    orderId: string,
    dto: ContinueWorkAnotherDayDto,
  ): Promise<{ order: Order; sessionsUsed: number; maxSessions: number }> {
    return this.technicianOps.continueWorkAnotherDay(userId, orderId, dto);
  }

  technicianCancel(userId: string, orderId: string, dto: CancelOrderAsTechnicianDto): Promise<Order> {
    return this.technicianOps.technicianCancel(userId, orderId, dto);
  }

  requestRematch(userId: string, orderId: string, dto: RequestRematchDto): Promise<Order> {
    return this.technicianOps.requestRematch(userId, orderId, dto);
  }

  depart(userId: string, orderId: string): Promise<Order> {
    return this.technicianOps.depart(userId, orderId);
  }

  arrive(userId: string, orderId: string): Promise<Order> {
    return this.technicianOps.arrive(userId, orderId);
  }

  start(userId: string, orderId: string): Promise<Order> {
    return this.technicianOps.start(userId, orderId);
  }

  complete(userId: string, orderId: string): Promise<Order> {
    return this.technicianOps.complete(userId, orderId);
  }


  // ── زيارة فاشلة/عدم حضور (docs/08 §22 بند 3-6) ──────────────────────────

  reportFailedVisit(user: JwtPayload, orderId: string, dto: ReportFailedVisitDto): Promise<Order> {
    return this.disputeFlow.reportFailedVisit(user, orderId, dto);
  }

  resolveFailedVisit(adminUserId: string, orderId: string, dto: ResolveFailedVisitDto, meta?: AuditActorMeta): Promise<Order> {
    return this.disputeFlow.resolveFailedVisit(adminUserId, orderId, dto, meta);
  }

  confirmCashHandover(userId: string, orderId: string): Promise<Order> {
    return this.disputeFlow.confirmCashHandover(userId, orderId);
  }

  reportCashNotReceived(user: JwtPayload, orderId: string, dto: ReportCashNotReceivedDto): Promise<Order> {
    return this.disputeFlow.reportCashNotReceived(user, orderId, dto);
  }

  resolveCashHandoverDispute(
    adminUserId: string,
    orderId: string,
    dto: ResolveCashDisputeDto,
    meta?: AuditActorMeta,
  ): Promise<Order> {
    return this.disputeFlow.resolveCashHandoverDispute(adminUserId, orderId, dto, meta);
  }

}
