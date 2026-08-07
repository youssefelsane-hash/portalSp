import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
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
  @RequirePermission('refunds.issue')
  async refundOrder(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundOrderDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toRefundResponseDto(await this.paymentsService.refundOrder(user.sub, id, dto.reason_notes, audit));
  }

  @Post('payouts/:id/approve')
  @RequirePermission('payouts.approve')
  async approvePayout(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @AuditContext() audit: AuditMeta,
  ) {
    return toPayoutResponseDto(await this.payoutsService.adminApprove(user.sub, id, audit));
  }

  @Post('payouts/:id/reject')
  @RequirePermission('payouts.approve')
  async rejectPayout(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPayoutDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toPayoutResponseDto(await this.payoutsService.adminReject(user.sub, id, dto.reason, audit));
  }

  @Post('payouts/:id/complete')
  @RequirePermission('payouts.approve')
  async completePayout(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @AuditContext() audit: AuditMeta,
  ) {
    return toPayoutResponseDto(await this.payoutsService.adminComplete(user.sub, id, audit));
  }
}
