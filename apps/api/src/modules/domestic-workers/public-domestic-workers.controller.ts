import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { DomesticWorkersService } from './domestic-workers.service';
import { BrowseWorkersQueryDto } from './dto/browse-workers-query.dto';
import { toPublicWorkerResponseDto } from './dto/worker-response.dto';

// تصفّح العميل لمقدّمي الخدمات المنزلية (docs/08 §12، ADR-0004) — نفس فلسفة اختيار الفني §3.
@Controller('domestic-workers')
@Roles(UserType.CUSTOMER)
export class PublicDomesticWorkersController {
  constructor(private readonly workersService: DomesticWorkersService) {}

  @Get()
  async browse(@Query() query: BrowseWorkersQueryDto) {
    const items = await this.workersService.browseForCustomer(query.specialty, query.latitude, query.longitude, {
      serviceId: query.service_id,
      scheduledAt: query.scheduled_at,
      durationHours: query.duration_hours,
    });
    return items.map((i) =>
      toPublicWorkerResponseDto(i.profile, i.fullName, i.distanceKm, i.availabilityStatus, i.unavailableReasonAr, i.availableAgainAt),
    );
  }

  @Get(':id')
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    const { profile, fullName } = await this.workersService.getPublicProfileOrThrow(id);
    return toPublicWorkerResponseDto(profile, fullName);
  }
}
