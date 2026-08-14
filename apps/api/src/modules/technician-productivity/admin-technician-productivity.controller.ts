import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { ProductivityQueryDto } from './dto/productivity-query.dto';
import { TechnicianProductivityService } from './technician-productivity.service';

// إنتاجية configurable (docs/08 §14) — قراءة بس، مفيش موافقة/دفع (Phase 1 حسابي بالكامل، راجع README).
@Controller('admin/technician-productivity')
@Roles(UserType.ADMIN)
@RequirePermission('technician_productivity.view')
export class AdminTechnicianProductivityController {
  constructor(private readonly productivityService: TechnicianProductivityService) {}

  @Get(':technicianId')
  async get(@Param('technicianId', ParseUUIDPipe) technicianId: string, @Query() query: ProductivityQueryDto) {
    return this.productivityService.computeForTechnician(technicianId, query.months);
  }
}
