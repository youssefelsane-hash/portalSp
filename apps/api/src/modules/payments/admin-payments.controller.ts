import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { PaymentsService } from './payments.service';
import { PayoutsService } from './payouts.service';
import { ListPayoutsQueryDto } from './dto/list-payouts-query.dto';
import { RefundOrderDto } from './dto/refund-order.dto';
import { RejectPayoutDto } from './dto/reject-payout.dto';
import {
  toAdminPayoutResponseDto,
  toPaymentResponseDto,
  toPayoutOrderItemResponseDto,
  toPayoutResponseDto,
  toRefundResponseDto,
} from './dto/payments-response.dto';

// كل المسارات هنا إدارية بحتة — راجع docs/02-data-dictionary.md §13.7
@Controller('admin')
@Roles(UserType.ADMIN)
export class AdminPaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly payoutsService: PayoutsService,
  ) {}

  // كانت فجوة موثّقة صراحة: approve/reject/complete تحت موجودين من زمان بس مفيش GET يرجّع
  // قايمة طلبات الصرف أصلاً — يعني الأدمن ملوش طريقة عملية يعرف الـ id يتصرف عليه.
  // بَقّة أمنية اتصلحت (docs/08 §19 بند 8): مكانتش عندها @RequirePermission خالص (RolesGuard
  // بس)، يعني أي حساب أدمن (مش finance/super_admin بس) كان يقدر يقرا بيانات صرف حساسة —
  // payouts.view جديدة (migration 0099)، ممنوحة لـfinance (super_admin بياخدها bypass).
  @Get('payouts')
  @RequirePermission('payouts.view')
  async listPayouts(@Query() query: ListPayoutsQueryDto) {
    const rows = await this.payoutsService.listForAdmin(query.status);
    return rows.map(toAdminPayoutResponseDto);
  }

  // كانت فجوة موثّقة: payout_order_items موجود في الـ schema من أول يوم بس مفيش حد كان بيملاه —
  // تفاصيل كاملة في ../../payouts/README.md. نفس بَقّة الصلاحية فوق.
  @Get('payouts/:id/order-items')
  @RequirePermission('payouts.view')
  async listPayoutOrderItems(@Param('id', ParseUUIDPipe) id: string) {
    const items = await this.payoutsService.listOrderItems(id);
    return items.map(toPayoutOrderItemResponseDto);
  }

  @Post('orders/:id/refund')
  @RequirePermission('refunds.issue')
  @RequireStepUp()
  async refundOrder(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundOrderDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toRefundResponseDto(
      await this.paymentsService.refundOrder(user.sub, id, dto.reason_notes, dto.amount_cents, audit),
    );
  }

  /**
   * تأكيد إداري يدوي لدفعة InstaPay (ADR-0013 §7) — صلاحية مخصوصة `payments.confirm_manual`
   * (Finance/Super Admin بس)، مش `refunds.issue` ولا أي صلاحية عامة. Idempotent فعليًا داخل
   * PaymentsService.confirmInstaPayPayment() (قفل pessimistic_write + فحص PENDING جوّه القفل) —
   * Audit كامل (الموظف/الوقت/المبلغ/الحالة قبل وبعد) بيتسجّل جوّه الخدمة نفسها.
   */
  @Post('payments/:id/confirm-instapay')
  @RequirePermission('payments.confirm_manual')
  async confirmInstaPayPayment(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @AuditContext() audit: AuditMeta,
  ) {
    const payment = await this.paymentsService.confirmInstaPayPayment(user.sub, id, audit);
    return toPaymentResponseDto(payment);
  }

  @Post('payouts/:id/approve')
  @RequirePermission('payouts.approve')
  @RequireStepUp()
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
  @RequireStepUp()
  async completePayout(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @AuditContext() audit: AuditMeta,
  ) {
    return toPayoutResponseDto(await this.payoutsService.adminComplete(user.sub, id, audit));
  }
}
