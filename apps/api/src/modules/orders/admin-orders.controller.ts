import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AdminOrdersService } from './admin-orders.service';
import { AdminCancelOrderDto } from './dto/admin-cancel-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { toOrderResponseDto } from './dto/order-response.dto';
import { toOrderStatusHistoryResponseDto } from './dto/order-status-history-response.dto';
import { ReassignOrderDto } from './dto/reassign-order.dto';

@Controller('admin/orders')
@Roles(UserType.ADMIN)
export class AdminOrdersController {
  constructor(private readonly adminOrdersService: AdminOrdersService) {}

  @Get()
  async list(@Query() query: ListOrdersQueryDto) {
    const { items, meta } = await this.adminOrdersService.list(query);
    return { items: items.map(toOrderResponseDto), meta };
  }

  @Get(':id')
  async getDetail(@Param('id', ParseUUIDPipe) id: string) {
    const { order, history } = await this.adminOrdersService.getDetail(id);
    return { ...toOrderResponseDto(order), status_history: history.map(toOrderStatusHistoryResponseDto) };
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
}
