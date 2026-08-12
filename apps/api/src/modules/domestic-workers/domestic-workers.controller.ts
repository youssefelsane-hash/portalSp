import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { DomesticWorkerBookingsService } from './domestic-worker-bookings.service';
import { DomesticWorkersService } from './domestic-workers.service';
import { UpdateWorkerLocationDto } from './dto/update-worker-location.dto';
import { UpdateWorkerProfileDto } from './dto/update-worker-profile.dto';
import { toWorkerResponseDto } from './dto/worker-response.dto';
import { toWorkerBookingResponseDto } from './dto/worker-booking-response.dto';

// خدمة ذاتية لمقدّم الخدمة المنزلية (شغالة/مربية/مقيمة) — docs/08 §12، ADR-0004.
@Controller('domestic-worker')
@Roles(UserType.DOMESTIC_WORKER)
export class DomesticWorkersController {
  constructor(
    private readonly workersService: DomesticWorkersService,
    private readonly bookingsService: DomesticWorkerBookingsService,
  ) {}

  @Get('me')
  async getMe(@CurrentUser() user: JwtPayload) {
    return toWorkerResponseDto(await this.workersService.findByUserIdOrThrow(user.sub));
  }

  @Patch('profile')
  async updateProfile(@CurrentUser() user: JwtPayload, @Body() dto: UpdateWorkerProfileDto) {
    return toWorkerResponseDto(await this.workersService.updateProfile(user.sub, dto));
  }

  @Post('location')
  @HttpCode(HttpStatus.OK)
  async updateLocation(@CurrentUser() user: JwtPayload, @Body() dto: UpdateWorkerLocationDto) {
    await this.workersService.updateLocation(user.sub, dto);
    return null;
  }

  @Post('request-review')
  async requestReview(@CurrentUser() user: JwtPayload) {
    return toWorkerResponseDto(await this.workersService.requestReview(user.sub));
  }

  @Get('bookings')
  async listBookings(@CurrentUser() user: JwtPayload) {
    const bookings = await this.bookingsService.listForWorker(user.sub);
    return bookings.map(toWorkerBookingResponseDto);
  }

  @Post('bookings/:id/confirm')
  async confirmBooking(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toWorkerBookingResponseDto(await this.bookingsService.confirm(user.sub, id));
  }

  @Post('bookings/:id/complete')
  async completeBooking(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toWorkerBookingResponseDto(await this.bookingsService.completeHourly(user.sub, id));
  }
}
