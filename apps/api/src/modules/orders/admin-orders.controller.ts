import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
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
import { AssignAssistantDto } from './dto/assign-assistant.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { toOrderFinancialSummaryResponseDto } from './dto/order-financial-summary-response.dto';
import { toOrderItemResponseDto } from './dto/order-item-response.dto';
import { toOrderMediaResponseDto } from './dto/order-media-response.dto';
import { toOrderPricingEvaluationResponseDto } from './dto/order-pricing-evaluation-response.dto';
import { toOrderResponseDto } from './dto/order-response.dto';
import { toTechnicianOrderCancellationResponseDto } from './dto/technician-order-cancellation-response.dto';
import { toOrderStatusHistoryResponseDto } from './dto/order-status-history-response.dto';
import { toTeamMemberResponseDto } from './dto/team-member-response.dto';
import { OrderItemsService } from './order-items.service';
import { OrderMediaService } from './order-media.service';
import { OrderTeamService } from './order-team.service';
import { ReassignOrderDto } from './dto/reassign-order.dto';
import { ResolveFailedVisitDto } from './dto/resolve-failed-visit.dto';
import { ResolveCashDisputeDto } from './dto/resolve-cash-dispute.dto';
import { OrdersService } from './orders.service';
import { PaymentsService } from '../payments/payments.service';

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
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  @Get()
  async list(@Query() query: ListOrdersQueryDto) {
    const { items, meta } = await this.adminOrdersService.list(query);
    return { items: items.map((order) => toOrderResponseDto(order)), meta };
  }

  @Get(':id')
  async getDetail(@Param('id', ParseUUIDPipe) id: string) {
    const { order, history, pricingEvaluation, technicianCancellations } = await this.adminOrdersService.getDetail(id);
    return {
      ...toOrderResponseDto(order),
      status_history: history.map(toOrderStatusHistoryResponseDto),
      // للتشغيل بس (docs/08 §35) — null لو الخدمة مش pricing_model=formula، راجع
      // PricingEngineService.findEvaluationForOrder().
      pricing_evaluation: pricingEvaluation ? toOrderPricingEvaluationResponseDto(pricingEvaluation) : null,
      // سياسة إلغاء الفني (docs/10) — قايمة فاضية لو الطلب ده معملوش أي فني إلغاء ذاتي. مصفوفة
      // مش صف واحد لأن نفس الطلب ممكن يتلغى من فني، يترجّع، ويتلغى من فني تاني.
      technician_cancellations: technicianCancellations.map(toTechnicianOrderCancellationResponseDto),
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
}
