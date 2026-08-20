import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { PaymentsService } from '../payments/payments.service';
import { toPaymentResponseDto, InstaPayReferenceResponseDto } from '../payments/dto/payments-response.dto';
import { DomesticWorkerBookingsService } from './domestic-worker-bookings.service';
import { CancelWorkerBookingDto } from './dto/cancel-worker-booking.dto';
import { CreateWorkerBookingDto } from './dto/create-worker-booking.dto';
import { toWorkerBookingResponseDto } from './dto/worker-booking-response.dto';

// حجوزات العميل لقطاع الخدمات المنزلية (docs/08 §12، ADR-0004).
@Controller('domestic-worker-bookings')
@Roles(UserType.CUSTOMER)
export class DomesticWorkerBookingsController {
  constructor(
    private readonly bookingsService: DomesticWorkerBookingsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateWorkerBookingDto) {
    return toWorkerBookingResponseDto(await this.bookingsService.create(user.sub, dto));
  }

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    const bookings = await this.bookingsService.listForCustomer(user.sub);
    return bookings.map(toWorkerBookingResponseDto);
  }

  @Post(':id/cancel')
  async cancel(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelWorkerBookingDto) {
    return toWorkerBookingResponseDto(await this.bookingsService.cancel(user.sub, id, dto));
  }

  /**
   * بدء دفع InstaPay للحجز بعد ما الشغالة توافق (status=awaiting_payment) — إعادة استخدام نفس
   * تدفق InstaPay اليدوي بتاع orders (docs/adr/0019)، مش نظام دفع مواز.
   */
  @Post(':id/pay-with-instapay')
  async payWithInstaPay(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<InstaPayReferenceResponseDto> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header مطلوب');
    }
    const { payment, referenceCode, instructionsAr } = await this.paymentsService.payDomesticWorkerBookingWithInstaPay(
      user.sub,
      id,
      idempotencyKey.trim(),
    );
    return { payment: toPaymentResponseDto(payment), reference_code: referenceCode, instructions_ar: instructionsAr };
  }

  /** العميل بيسجّل "أنا حوّلت الفلوس فعلاً" — نفس منطق confirm-instapay-transfer بتاع orders. */
  @Post(':id/confirm-instapay-transfer')
  async confirmInstaPayTransfer(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const payment = await this.paymentsService.confirmDomesticWorkerBookingInstaPayTransferByCustomer(user.sub, id);
    return toPaymentResponseDto(payment);
  }
}
