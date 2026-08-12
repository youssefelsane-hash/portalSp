import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { DomesticWorkerBookingsService } from './domestic-worker-bookings.service';
import { CancelWorkerBookingDto } from './dto/cancel-worker-booking.dto';
import { CreateWorkerBookingDto } from './dto/create-worker-booking.dto';
import { toWorkerBookingResponseDto } from './dto/worker-booking-response.dto';

// حجوزات العميل لقطاع الخدمات المنزلية (docs/08 §12، ADR-0004).
@Controller('domestic-worker-bookings')
@Roles(UserType.CUSTOMER)
export class DomesticWorkerBookingsController {
  constructor(private readonly bookingsService: DomesticWorkerBookingsService) {}

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
}
