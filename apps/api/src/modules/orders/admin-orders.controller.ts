import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
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
  async cancel(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCancelOrderDto,
  ) {
    return toOrderResponseDto(await this.adminOrdersService.cancel(admin.sub, id, dto.reason));
  }

  @Post(':id/reassign')
  @HttpCode(HttpStatus.OK)
  async reassign(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReassignOrderDto,
  ) {
    return toOrderResponseDto(await this.adminOrdersService.reassign(admin.sub, id, dto.technician_id));
  }
}
