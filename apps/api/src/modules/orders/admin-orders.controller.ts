import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AdminOrdersService } from './admin-orders.service';
import { AdjustOrderPriceDto } from './dto/adjust-order-price.dto';
import { AdminCancelOrderDto } from './dto/admin-cancel-order.dto';
import { AssignAssistantDto } from './dto/assign-assistant.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
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

@Controller('admin/orders')
@Roles(UserType.ADMIN)
export class AdminOrdersController {
  constructor(
    private readonly adminOrdersService: AdminOrdersService,
    private readonly orderMediaService: OrderMediaService,
    private readonly orderItemsService: OrderItemsService,
    private readonly orderTeamService: OrderTeamService,
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

  // كانت فجوة موثّقة: GET /technician/orders/:id/media مقصور على @Roles(TECHNICIAN) بس —
  // الأدمن مالوش أي طريقة يشوف صور قبل/بعد لمراجعة جودة أو حل شكوى. نفس OrderMediaService،
  // مسار مختلف بصلاحية مختلفة، مفيش تكرار منطق.
  @Get(':id/media')
  async listMedia(@Param('id', ParseUUIDPipe) id: string) {
    const media = await this.orderMediaService.listForOrder(id);
    return media.map(toOrderMediaResponseDto);
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

  @Patch(':id/adjust-price')
  @RequirePermission('orders.adjust_price')
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
