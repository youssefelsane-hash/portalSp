import { BadRequestException, Body, Controller, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { PaymentsService } from './payments.service';
import { CardPaymentResponseDto, FawryReferenceResponseDto, toPaymentResponseDto } from './dto/payments-response.dto';

@Controller('orders')
@Roles(UserType.CUSTOMER)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post(':id/pay-with-wallet')
  async payWithWallet(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    // كل عملية دفع لازم Idempotency-Key — docs/01-master-plan.md §1.4، عشان retry من الشبكة
    // ميعملش دفعتين لنفس الطلب. مش اختياري.
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header مطلوب');
    }

    const payment = await this.paymentsService.payWithWallet(user.sub, id, idempotencyKey.trim());
    return toPaymentResponseDto(payment);
  }

  @Post(':id/pay-with-card')
  async payWithCard(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<CardPaymentResponseDto> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header مطلوب');
    }

    const { payment, redirectUrl } = await this.paymentsService.payWithCard(user.sub, id, idempotencyKey.trim());
    return { payment: toPaymentResponseDto(payment), redirect_url: redirectUrl };
  }

  @Post(':id/pay-with-fawry-reference')
  async payWithFawryReference(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<FawryReferenceResponseDto> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header مطلوب');
    }

    const { payment, referenceNumber, expiresAt } = await this.paymentsService.payWithFawryReference(
      user.sub,
      id,
      idempotencyKey.trim(),
    );
    return { payment: toPaymentResponseDto(payment), reference_number: referenceNumber, expires_at: expiresAt.toISOString() };
  }
}
