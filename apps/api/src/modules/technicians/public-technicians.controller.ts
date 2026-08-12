import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { ScheduleQueryDto } from './dto/schedule-query.dto';
import { toPublicScheduleSlotResponseDto } from './dto/schedule-slot-response.dto';
import { toPublicTechnicianProfileResponseDto } from './dto/public-technician-profile-response.dto';
import { TechnicianScheduleService } from './technician-schedule.service';
import { TechniciansService } from './technicians.service';

// بروفايل الفني العام — العميل يشوفه قبل الحجز (تصفّح) أو بعده (إعادة حجز/مراجعة). منفصل عن
// GET /technician/me (خاص بالفني نفسه) وعن /admin/technicians/:id (إدارة). راجع technicians/README.md.
@Controller('technicians')
@Roles(UserType.CUSTOMER)
export class PublicTechniciansController {
  constructor(
    private readonly techniciansService: TechniciansService,
    private readonly scheduleService: TechnicianScheduleService,
  ) {}

  @Get(':id/profile')
  async getPublicProfile(@Param('id', ParseUUIDPipe) id: string) {
    return toPublicTechnicianProfileResponseDto(await this.techniciansService.getPublicProfile(id));
  }

  // الجدول "أخضر/أحمر" (docs/08 §2) — is_available بس، مفيش order_id ولا ملاحظات داخلية.
  @Get(':id/schedule')
  async getPublicSchedule(@Param('id', ParseUUIDPipe) id: string, @Query() query: ScheduleQueryDto) {
    const slots = await this.scheduleService.listForTechnician(id, query.from, query.to);
    return slots.map(toPublicScheduleSlotResponseDto);
  }
}
