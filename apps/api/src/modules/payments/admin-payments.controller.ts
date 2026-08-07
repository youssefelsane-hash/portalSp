import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { PaymentsService } from './payments.service';
import { PayoutsService } from './payouts.service';
import { RefundOrderDto } from './dto/refund-order.dto';
import { RejectPayoutDto } from './dto/reject-payout.dto';
import { toPayoutResponseDto, toRefundResponseDto } from './dto/payments-response.dto';

// كل المسارات هنا إدارية بحتة — راجع docs/02-data-dictionary.md §13.7
@Controller('admin')
@Roles(UserType.ADMIN)
export class AdminPaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly payoutsService: PayoutsService,
  ) {}

  @Post('orders/:id/refund')
  async refundOrder(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundOrderDto,
  ) {
    return toRefundResponseDto(await this.paymentsService.refundOrder(user.sub, id, dto.reason_notes));
  }

  @Post('payouts/:id/approve')
  async approvePayout(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toPayoutResponseDto(await this.payoutsService.adminApprove(user.sub, id));
  }

  @Post('payouts/:id/reject')
  async rejectPayout(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPayoutDto,
  ) {
    return toPayoutResponseDto(await this.payoutsService.adminReject(user.sub, id, dto.reason));
  }

  @Post('payouts/:id/complete')
  async completePayout(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toPayoutResponseDto(await this.payoutsService.adminComplete(user.sub, id));
  }
}
