import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AdminOrdersService } from './admin-orders.service';
import { AdjustOrderPriceDto } from './dto/adjust-order-price.dto';
import { AdminCancelOrderDto } from './dto/admin-cancel-order.dto';
import { AdminRescheduleOrderDto } from './dto/admin-reschedule-order.dto';
import { AssignAssistantDto } from './dto/assign-assistant.dto';
import { AddCrewMemberDto, ReassignLeaderDto, RemoveCrewMemberDto, ReplaceCrewMemberDto } from './dto/admin-crew-member.dto';
import { CreateOrderForCustomerDto } from './dto/create-order-for-customer.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { toOrderFinancialSummaryResponseDto } from './dto/order-financial-summary-response.dto';
import { toOrderItemResponseDto } from './dto/order-item-response.dto';
import { toOrderMediaResponseDto } from './dto/order-media-response.dto';
import { toOrderPricingEvaluationResponseDto } from './dto/order-pricing-evaluation-response.dto';
import { toOrderResponseDto } from './dto/order-response.dto';
import { toTechnicianOrderCancellationResponseDto } from './dto/technician-order-cancellation-response.dto';
import { toOrderStatusHistoryResponseDto } from './dto/order-status-history-response.dto';
import { toOrderTimelineEventResponseDto } from './dto/order-timeline-event-response.dto';
import { toTeamMemberResponseDto } from './dto/team-member-response.dto';
import { OrderItemsService } from './order-items.service';
import { OrderMediaService } from './order-media.service';
import { OrderTeamService } from './order-team.service';
import { ReassignOrderDto } from './dto/reassign-order.dto';
import { ResolveFailedVisitDto } from './dto/resolve-failed-visit.dto';
import { ResolveCashDisputeDto } from './dto/resolve-cash-dispute.dto';
import { OrdersService } from './orders.service';
import { PaymentsService } from '../payments/payments.service';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { MatchingExplainabilityService } from '../matching/matching-explainability.service';

@Controller('admin/orders')
@Roles(UserType.ADMIN)
export class AdminOrdersController {
  constructor(
    private readonly adminOrdersService: AdminOrdersService,
    private readonly ordersService: OrdersService,
    private readonly orderMediaService: OrderMediaService,
    private readonly orderItemsService: OrderItemsService,
    private readonly orderTeamService: OrderTeamService,
    private readonly paymentsService: PaymentsService,
    private readonly techniciansService: TechniciansService,
    private readonly workOpportunities: TechnicianWorkOpportunitiesService,
    private readonly matchingExplainabilityService: MatchingExplainabilityService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  @Get()
  async list(@Query() query: ListOrdersQueryDto) {
    const { items, meta } = await this.adminOrdersService.list(query);
    return { items: items.map((order) => toOrderResponseDto(order)), meta };
  }

  @Get(':id')
  async getDetail(@Param('id', ParseUUIDPipe) id: string) {
    const { order, history, pricingEvaluation, technicianCancellations, crewStatus, crewShortageUrgent } =
      await this.adminOrdersService.getDetail(id);
    // اسم/تليفون الفني بيبانوا للأدمن دايمًا طالما فيه فني معيّن (بخلاف عقد العميل
    // TECHNICIAN_CONTACT_VISIBLE_STATUSES اللي حماية IDOR ضد العميل قبل تأكيد حجز حقيقي — مبدأ
    // مختلف تمامًا، مش ينطبق على موظف عمليات عنده صلاحية RBAC كاملة على الطلب أصلاً). كانت فجوة
    // عرض حقيقية: شاشة تفاصيل الطلب كانت بتعرض technician_id كـUUID خام بلا اسم/رقم، وموظف
    // العمليات مضطر ينسخ الـUUID يدويًا عشان يعرف مين الفني المُعيَّن.
    const technicianContact = order.technicianId
      ? await this.techniciansService.findContactInfoOrThrow(order.technicianId)
      : null;
    return {
      ...toOrderResponseDto(order, undefined, technicianContact),
      status_history: history.map(toOrderStatusHistoryResponseDto),
      // للتشغيل بس (docs/08 §35) — null لو الخدمة مش pricing_model=formula، راجع
      // PricingEngineService.findEvaluationForOrder().
      pricing_evaluation: pricingEvaluation ? toOrderPricingEvaluationResponseDto(pricingEvaluation) : null,
      // سياسة إلغاء الفني (docs/10) — قايمة فاضية لو الطلب ده معملوش أي فني إلغاء ذاتي. مصفوفة
      // مش صف واحد لأن نفس الطلب ممكن يتلغى من فني، يترجّع، ويتلغى من فني تاني.
      technician_cancellations: technicianCancellations.map(toTechnicianOrderCancellationResponseDto),
      // docs/08 §35، ADR-0021 §1 — null لطلبات فردية/طوارئ (crew مش مفهوم منطبق أصلاً).
      crew_status: crewStatus,
      // docs/08 §35.5 — "الطلب مميّز بصريًا" لما نقص الطاقم يعدّي عتبة التصعيد. محسوب وقت
      // القراءة (نفس عتبة CrewShortageEscalationService)، false دايمًا لطلبات فردية/طوارئ.
      crew_shortage_urgent: crewShortageUrgent,
    };
  }

  // تفسير مطابقة (docs/08 §35.7، ADR-0021 §4) — "ليه الفني ده مش بياخد الطلب ده؟" بنفس شروط
  // MatchingService.findEligibleTechnicians() الحقيقية بالحرف (صفر خوارزمية تشخيصية موازية).
  // قراءة بس، أي أدمن (نفس نمط getTimeline/listTeamMembers فوق).
  @Get(':id/technicians/:technicianId/explain')
  async explainTechnicianEligibility(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('technicianId', ParseUUIDPipe) technicianId: string,
  ) {
    const { order } = await this.adminOrdersService.getDetail(id);
    const explanation = await this.matchingExplainabilityService.explainTechnicianForOrder(order, technicianId);
    return {
      technician_id: explanation.technicianId,
      order_id: explanation.orderId,
      eligible: explanation.eligible,
      reason_ar: explanation.reasonAr,
      capacity_tier: explanation.capacityTier,
      distance_km: explanation.distanceKm,
      checks: explanation.checks.map((c) => ({ key: c.key, passed: c.passed, label_ar: c.labelAr })),
    };
  }

  // فانل مطابقة الطلب (docs/08 §35.8، ADR-0021 §4) — "ليه الطلب ده لسه بيدوّر؟" قراءة بس، أي أدمن.
  @Get(':id/matching-funnel')
  async getMatchingFunnel(@Param('id', ParseUUIDPipe) id: string) {
    const { order } = await this.adminOrdersService.getDetail(id);
    const funnel = await this.matchingExplainabilityService.explainOrderFunnel(order);
    return {
      order_id: funnel.orderId,
      order_status: funnel.orderStatus,
      pool: {
        category_eligible: funnel.pool.categoryEligible,
        zone_eligible: funnel.pool.zoneEligible,
        blocked: funnel.pool.blocked,
        heavy: funnel.pool.heavy,
        meaningful: funnel.pool.meaningful,
        light: funnel.pool.light,
      },
      dispatch_assignments: funnel.dispatchAssignments,
      crew_recruit_opportunities: funnel.crewRecruitOpportunities,
      crew_status: funnel.crewStatus,
    };
  }

  // Call Center — إنشاء طلب نيابة عن عميل (Script 4 §33-37). صلاحية مخصصة (orders.create_for_customer)
  // مش ممنوحة تلقائيًا لكل أدمن — راجع migration 0131. نفس OrdersService.create() الحقيقي بالحرف
  // (نفس التحقق/التسعير/الجدولة)، الفرق الوحيد هو مين "العميل" اللي بيتحسب منه customer_id.
  @Post('for-customer')
  @RequirePermission('orders.create_for_customer')
  async createForCustomer(
    @CurrentUser() admin: JwtPayload,
    @Body() dto: CreateOrderForCustomerDto,
    @AuditContext() audit: AuditMeta,
    // Idempotency-Key اختياري (migration 0139، Script 7 Phase 9) — نفس حماية مسار العميل العادي،
    // موظف مركز الاتصال ممكن يدوس زرار "أنشئ الطلب" مرتين برضو.
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    const { customer_user_id, ...createDto } = dto;
    const order = await this.ordersService.create(
      customer_user_id,
      createDto,
      undefined,
      { adminUserId: admin.sub, meta: audit },
      idempotencyKey?.trim() || undefined,
    );
    return {
      ...toOrderResponseDto(order),
      customer_user_id,
      created_by_admin_user_id: admin.sub,
      source_channel: order.sourceChannel,
    };
  }

  // الملخص المالي لطلب واحد (docs/08 §20 بند 11) — كانت فجوة عرض حقيقية: عمولة المنصة/أرباح
  // الفني محسوبة ومخزّنة على الطلب من زمان (docs/08 §20 بند 1) بس صفر endpoint كان بيرجّعها، ومفيش
  // طريقة تعرف وسيلة الدفع أو تاريخ الاسترداد لطلب معيّن من غير تفتيش يدوي في /admin/wallets.
  @Get(':id/financial-summary')
  async getFinancialSummary(@Param('id', ParseUUIDPipe) id: string) {
    const summary = await this.paymentsService.getFinancialSummaryForOrder(id);
    return toOrderFinancialSummaryResponseDto(summary);
  }

  // كانت فجوة موثّقة: GET /technician/orders/:id/media مقصور على @Roles(TECHNICIAN) بس —
  // الأدمن مالوش أي طريقة يشوف صور قبل/بعد لمراجعة جودة أو حل شكوى. نفس OrderMediaService،
  // مسار مختلف بصلاحية مختلفة، مفيش تكرار منطق.
  @Get(':id/media')
  async listMedia(@Param('id', ParseUUIDPipe) id: string) {
    const media = await this.orderMediaService.listForOrder(id);
    return Promise.all(media.map((m) => toOrderMediaResponseDto(m, this.storage)));
  }

  // نفس نمط listMedia فوق — الأدمن محتاج يشوف بنود عرض السعر (مقترحة/معتمدة) وقت مراجعة شكوى
  // أو دعم فني، تفاصيل كاملة في order-items.service.ts.
  @Get(':id/quote-items')
  async listQuoteItems(@Param('id', ParseUUIDPipe) id: string) {
    const items = await this.orderItemsService.listForOrder(id);
    return items.map(toOrderItemResponseDto);
  }

  // Timeline موحّد لتفاصيل الطلب (Script 4 Part G §30-32) — كانت فجوة موثّقة صراحة: audit log
  // (/audit-log page منفصلة تمامًا)، status_history (كارت في getDetail فوق)، order_assignments
  // (مفيش عرض إداري خالص قبل كده)، وtechnician_order_cancellations (كارت منفصل في getDetail)
  // كل واحد بيتعرض لوحده. صفر صلاحية إضافية (نفس listTeamMembers/listMedia/listQuoteItems فوق
  // — قراءة بس، أي أدمن).
  @Get(':id/timeline')
  async getTimeline(@Param('id', ParseUUIDPipe) id: string) {
    return (await this.adminOrdersService.getTimeline(id)).map(toOrderTimelineEventResponseDto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('orders.cancel')
  async cancel(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCancelOrderDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toOrderResponseDto(await this.adminOrdersService.cancel(admin.sub, id, dto.reason, audit));
  }

  // ADR-0017 بند 4 — قايمة الفنيين المؤهلين فعليًا لهذا الطلب بالذات (خدمة/منطقة/موعد)، نفس
  // المصدر المستخدم في اختيار العميل. بديل عن /admin/technicians?verification_status=approved
  // العام اللي كان مستخدم في واجهة إعادة التعيين قبل كده بلا أي فلترة أهلية حقيقية.
  @Get(':id/eligible-technicians')
  @RequirePermission('orders.reassign')
  async listEligibleTechnicians(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminOrdersService.listEligibleTechniciansForReassign(id);
  }

  // شفافية "ليه الطلب ده اتوزّع بالشكل ده" (docs/08 §34.4، ADR-0020 §W) — مين اتعرضله فرصة شغل
  // إضافي اختيارية، بأي تصنيف قدرة استيعابية وقتها، وقرر إيه. منفصل عن eligible-technicians فوق
  // (ده بيسأل "مين مؤهّل دلوقتي"، ده بيسأل "مين اتعرض عليه فعليًا وحصل إيه").
  @Get(':id/work-opportunities')
  async listWorkOpportunities(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.workOpportunities.listForOrderAdmin(id);
    return {
      items: rows.map((row) => ({
        id: row.id,
        technician_id: row.technician_id,
        technician_code: row.technician_code,
        technician_full_name: row.technician_full_name,
        capacity_tier_at_offer: row.capacity_tier_at_offer,
        status: row.status,
        offered_at: row.offered_at,
        decided_at: row.decided_at,
      })),
    };
  }

  @Post(':id/reassign')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('orders.reassign')
  async reassign(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReassignOrderDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toOrderResponseDto(await this.adminOrdersService.reassign(admin.sub, id, dto.technician_id, audit));
  }

  // إعادة جدولة عامة من الأدمن (Script 4 Part K §42) — بعكس POST /orders/:id/reschedule (مقصور
  // على العميل صاحب الطلب)، ده لأي طلب. نفس آلية الحجز الذرّي بالحرف (OrdersService.rescheduleCore
  // المشتركة)، مفيش تكرار منطق. مفيش step-up MFA هنا (بعكس adjust-price/resolve-failed-visit
  // تحت) — تغيير موعد مش قرار مالي، نفس مستوى حساسية reassign فوقها بالظبط.
  @Post(':id/reschedule')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('orders.reschedule')
  async rescheduleByAdmin(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminRescheduleOrderDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toOrderResponseDto(await this.ordersService.rescheduleByAdmin(admin.sub, id, dto.new_slot_id, dto.reason, audit));
  }

  // بَقّة أمنية حقيقية اتلقطت واتصلحت (تدقيق جاهزية الإطلاق النهائي، 2026-08-14): orders.adjust_price
  // مُدرجة في MFA_REQUIRED_PERMISSIONS (mfa-policy.service.ts) بس @RequireStepUp() الفعلية
  // متضافتش خالص — جلسة مسروقة كانت تقدر تعدّل سعر أي طلب من غير أي تأكيد Passkey حديث.
  @Patch(':id/adjust-price')
  @RequirePermission('orders.adjust_price')
  @RequireStepUp()
  async adjustPrice(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustOrderPriceDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toOrderResponseDto(
      await this.adminOrdersService.adjustPrice(admin.sub, id, dto.new_total_amount_cents, dto.reason, audit),
    );
  }

  // زيارة فاشلة/عدم حضور (docs/08 §22 بند 4-5) — قرار مالي (رسوم + استرداد)، نفس مستوى حساسية
  // orders.adjust_price بالحرف (permission مخصوصة + step-up MFA، migration 0107).
  @Post(':id/resolve-failed-visit')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('orders.resolve_failed_visit')
  @RequireStepUp()
  async resolveFailedVisit(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveFailedVisitDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toOrderResponseDto(await this.ordersService.resolveFailedVisit(admin.sub, id, dto, audit));
  }

  // نزاع تسليم كاش (docs/08 §22 بند 13-14) — قرار مالي محتمل (confirm_received)، نفس مستوى حساسية
  // orders.resolve_failed_visit بالحرف (permission مخصوصة + step-up MFA، migration 0108).
  @Post(':id/resolve-cash-dispute')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('orders.resolve_cash_dispute')
  @RequireStepUp()
  async resolveCashDispute(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveCashDisputeDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toOrderResponseDto(await this.ordersService.resolveCashHandoverDispute(admin.sub, id, dto, audit));
  }

  // الأدمن محتاج يشوف أعضاء الفريق (فريق "اعتماد" + مساعدين) عشان يعرف كام مساعد لسه ناقص قبل
  // ما يعيّن يدوي — نفس OrderTeamService.listForOrder() اللي customer/technician controllers
  // بيستخدموها، مفيش أي endpoint إداري كان بيعرضها قبل كده.
  @Get(':id/team-members')
  async listTeamMembers(@Param('id', ParseUUIDPipe) id: string) {
    return (await this.orderTeamService.listForOrder(id)).map(toTeamMemberResponseDto);
  }

  // تعيين مساعد يدوي بعد تصعيد مطابقة المساعد التلقائية — ADR-0008 (يمتد ADR-0007 §7 اللي أجّل
  // الحل ده صراحة عن نطاقه الأول).
  @Post(':id/assistants')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('orders.assign_assistant')
  async assignAssistant(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignAssistantDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toOrderResponseDto(
      await this.adminOrdersService.assignAssistant(admin.sub, id, dto.technician_id, audit),
    );
  }

  // إدارة طاقم الطلب من الأدمن (Script 4 §22-29، §38-41) — كانت فجوة موثّقة صراحة:
  // OrderTeamService.addMember()/removeMember() مقصورين على الفني القائد بس. صلاحية مخصصة
  // (orders.manage_crew، migration 0132)، أعرض من assign_assistant (أي دور طاقم، مش "مساعد" بس).
  @Post(':id/team-members')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('orders.manage_crew')
  async addCrewMember(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCrewMemberDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toOrderResponseDto(
      await this.adminOrdersService.addCrewMember(admin.sub, id, dto.technician_id, dto.role_label, audit),
    );
  }

  @Post(':id/team-members/:memberId/remove')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('orders.manage_crew')
  async removeCrewMember(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: RemoveCrewMemberDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.adminOrdersService.removeCrewMember(admin.sub, id, memberId, dto.reason, audit);
  }

  @Post(':id/team-members/:memberId/replace')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('orders.manage_crew')
  async replaceCrewMember(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: ReplaceCrewMemberDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toOrderResponseDto(
      await this.adminOrdersService.replaceCrewMember(
        admin.sub,
        id,
        memberId,
        dto.new_technician_id,
        dto.reason,
        dto.role_label,
        audit,
      ),
    );
  }

  // تغيير قائد الطلب (docs/08 §35، ADR-0021 §5) — كانت فجوة حقيقية: reassign() تحت مقصورة على
  // مرحلة "قبل القبول" (REASSIGNABLE_STATUSES)، مش تقدر تُستخدم لطلب فريق بعد ما القبول وتجميع
  // الطاقم حصلوا بالفعل. نفس صلاحية إدارة الطاقم (orders.manage_crew) — تغيير القائد قرار تشغيلي
  // يومي زي إضافة/إزالة عضو، مش قرار super_admin منفصل.
  @Post(':id/reassign-leader')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('orders.manage_crew')
  async reassignLeader(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReassignLeaderDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toOrderResponseDto(
      await this.adminOrdersService.reassignLeader(admin.sub, id, dto.new_leader_technician_id, dto.reason, audit),
    );
  }
}
