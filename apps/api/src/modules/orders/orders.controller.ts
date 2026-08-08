import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AddressesService } from '../customers/addresses.service';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { CreateOrderDto } from './dto/create-order.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { toOrderResponseDto } from './dto/order-response.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
@Roles(UserType.CUSTOMER)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly addressesService: AddressesService,
  ) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    const orders = await this.ordersService.findAllForCustomerUser(user.sub);
    return orders.map((order) => toOrderResponseDto(order));
  }

  @Get(':id')
  async getOne(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const order = await this.ordersService.findOneOwnedOrThrow(user.sub, id);
    // العنوان بتاع العميل نفسه — findOwnedOrThrow بيتحقق من الملكية برضه (دفاع مزدوج رخيص)
    const address = await this.addressesService.findOwnedOrThrow(user.sub, order.addressId);
    return toOrderResponseDto(order, address);
  }

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateOrderDto) {
    return toOrderResponseDto(await this.ordersService.create(user.sub, dto));
  }

  @Post(':id/cancel')
  async cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
  ) {
    return toOrderResponseDto(await this.ordersService.cancel(user.sub, id, dto));
  }
}
