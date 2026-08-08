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
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { toOrderItemResponseDto } from './dto/order-item-response.dto';
import { toOrderMediaResponseDto } from './dto/order-media-response.dto';
import { toOrderResponseDto } from './dto/order-response.dto';
import { toOrderStatusHistoryResponseDto } from './dto/order-status-history-response.dto';
import { OrderItemsService } from './order-items.service';
import { OrderMediaService } from './order-media.service';
import { ReassignOrderDto } from './dto/reassign-order.dto';

@Controller('admin/orders')
@Roles(UserType.ADMIN)
export class AdminOrdersController {
  constructor(
    private readonly adminOrdersService: AdminOrdersService,
    private readonly orderMediaService: OrderMediaService,
    private readonly orderItemsService: OrderItemsService,
  ) {}

  @Get()
  async list(@Query() query: ListOrdersQueryDto) {
    const { items, meta } = await this.adminOrdersService.list(query);
    return { items: items.map((order) => toOrderResponseDto(order)), meta };
  }

  @Get(':id')
  async getDetail(@Param('id', ParseUUIDPipe) id: string) {
    const { order, history } = await this.adminOrdersService.getDetail(id);
    return { ...toOrderResponseDto(order), status_history: history.map(toOrderStatusHistoryResponseDto) };
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
}
