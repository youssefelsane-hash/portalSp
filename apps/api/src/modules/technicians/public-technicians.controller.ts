import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { ScheduleQueryDto } from './dto/schedule-query.dto';
import { toPublicScheduleSlotResponseDto } from './dto/schedule-slot-response.dto';
import { toPublicTechnicianProfileResponseDto } from './dto/public-technician-profile-response.dto';
import { TechnicianScheduleService } from './technician-schedule.service';
import { TechniciansService } from './technicians.service';

// بروفايل الفني العام — العميل يشوفه قبل الحجز (تصفّح) أو بعده (إعادة حجز/مراجعة). منفصل عن
// GET /technician/me (خاص بالفني نفسه) وعن /admin/technicians/:id (إدارة). راجع technicians/README.md.
@Controller('technicians')
@Roles(UserType.CUSTOMER, UserType.ADMIN)
export class PublicTechniciansController {
  constructor(
    private readonly techniciansService: TechniciansService,
    private readonly scheduleService: TechnicianScheduleService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  @Get(':id/profile')
  async getPublicProfile(@Param('id', ParseUUIDPipe) id: string) {
    return toPublicTechnicianProfileResponseDto(await this.techniciansService.getPublicProfile(id), this.storage);
  }

  // الجدول "أخضر/أحمر" (docs/08 §2) — is_available بس، مفيش order_id ولا ملاحظات داخلية.
  // بَقّة أمنية سابقة/فجوة استخدام (docs/08 §25.2): كانت مقصورة على العميل — الأدمن محتاج نفس
  // الجدول برضه عشان يقدر يختار سلوت حقيقي وقت حل نزاع "زيارة فاشلة" (resolveFailedVisit).
  @Get(':id/schedule')
  async getPublicSchedule(@Param('id', ParseUUIDPipe) id: string, @Query() query: ScheduleQueryDto) {
    const slots = await this.scheduleService.listForTechnician(id, query.from, query.to);
    return slots.map(toPublicScheduleSlotResponseDto);
  }
}
