import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { PaymentsService } from './payments.service';
import { PayoutsService } from './payouts.service';
import { TechnicianEarningsService } from './technician-earnings.service';
import { TechniciansService } from '../technicians/technicians.service';
import { RequestPayoutDto } from './dto/request-payout.dto';
import { toPaymentResponseDto, toPayoutOrderItemResponseDto, toPayoutResponseDto } from './dto/payments-response.dto';
import { TechnicianMonthlyStatement } from './technician-earnings.service';

/**
 * Public worker view of the monthly statement. The full statement is intentionally kept inside
 * the service for admin reconciliation, but workers only receive their own share and wallet
 * movements. Order totals, customer discounts and platform economics must never cross this API.
 */
export function toTechnicianStatementResponse(statement: TechnicianMonthlyStatement) {
  return {
    month: statement.month,
    monthStart: statement.monthStart,
    monthEnd: statement.monthEnd,
    isCurrentMonth: statement.isCurrentMonth,
    jobsCount: statement.jobsCount,
    totals: {
      refundReversalCents: statement.totals.refundReversalCents,
      grossTechnicianEarningCents: statement.totals.grossTechnicianEarningCents,
      cashCollectedCents: statement.totals.cashCollectedCents,
      netTechnicianDueCents: statement.totals.netTechnicianDueCents,
    },
    jobs: statement.jobs.map((job) => ({
      orderId: job.orderId,
      orderNumber: job.orderNumber,
      serviceNameAr: job.serviceNameAr,
      closedAt: job.closedAt,
      participantRole: job.participantRole,
      refundReversalCents: job.refundReversalCents,
      grossTechnicianEarningCents: job.grossTechnicianEarningCents,
      cashCollectedCents: job.cashCollectedCents,
      netTechnicianDueCents: job.netTechnicianDueCents,
    })),
  };
}

@Controller()
@Roles(UserType.TECHNICIAN)
export class TechnicianPaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly payoutsService: PayoutsService,
    private readonly earningsService: TechnicianEarningsService,
    private readonly techniciansService: TechniciansService,
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

  /**
   * كشف مستحقات الشهر (docs/08 §61.1، ADR-0038). من غير `month` بيرجّع الشهر الحالي —
   * «إجمالي مستحقات الفني للشهر الحالي حتى هذه اللحظة».
   */
  @Get('technician/earnings/statement')
  async monthlyStatement(@CurrentUser() user: JwtPayload, @Query('month') month?: string) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    return toTechnicianStatementResponse(
      await this.earningsService.getMonthlyStatement(
        profile.id,
        month ?? TechnicianEarningsService.currentMonthCairo(),
      ),
    );
  }

  /** الشهور اللي فيها شغل مقفول (الأحدث الأول) — لمنتقي الشهر في التطبيق. */
  @Get('technician/earnings/months')
  async availableMonths(@CurrentUser() user: JwtPayload) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    return { months: await this.earningsService.listAvailableMonths(profile.id) };
  }
}
