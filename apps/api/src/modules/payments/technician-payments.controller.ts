import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { PaymentsService } from './payments.service';
import { PayoutsService } from './payouts.service';
import { RequestPayoutDto } from './dto/request-payout.dto';
import { toPaymentResponseDto, toPayoutOrderItemResponseDto, toPayoutResponseDto } from './dto/payments-response.dto';

@Controller()
@Roles(UserType.TECHNICIAN)
export class TechnicianPaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly payoutsService: PayoutsService,
  ) {}

  @Post('technician/orders/:id/collect-cash')
  async collectCash(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toPaymentResponseDto(await this.paymentsService.collectCash(user.sub, id));
  }

  @Post('technician/payouts')
  async requestPayout(@CurrentUser() user: JwtPayload, @Body() dto: RequestPayoutDto) {
    return toPayoutResponseDto(await this.payoutsService.requestPayout(user.sub, dto));
  }

  @Get('technician/payouts')
  async listPayouts(@CurrentUser() user: JwtPayload) {
    const payouts = await this.payoutsService.listForTechnician(user.sub);
    return payouts.map(toPayoutResponseDto);
  }

  @Get('technician/payouts/:id/order-items')
  async listPayoutOrderItems(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const items = await this.payoutsService.listOrderItemsForTechnician(user.sub, id);
    return items.map(toPayoutOrderItemResponseDto);
  }
}
