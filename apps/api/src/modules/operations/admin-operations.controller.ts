import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { AdminOperationsOverviewService } from './admin-operations-overview.service';
import { OperationsOverviewQueryDto } from './dto/operations-overview-query.dto';

// مركز العمليات (docs/08 §36.2 فصاعدًا) — بداية قسم جديد كامل بيتوسّع مرحلة بمرحلة (§36.3-14).
@Controller('admin/operations')
@Roles(UserType.ADMIN)
export class AdminOperationsController {
  constructor(private readonly overviewService: AdminOperationsOverviewService) {}

  @Get('overview')
  async getOverview(@Query() query: OperationsOverviewQueryDto) {
    const overview = await this.overviewService.getOverview({ categoryId: query.category_id ?? null });
    return {
      dispatch_pending_count: overview.dispatchPendingCount,
      crew_shortage_open_count: overview.crewShortageOpenCount,
      technicians_online_count: overview.techniciansOnlineCount,
      capacity_today: {
        light: overview.capacityToday.light,
        meaningful: overview.capacityToday.meaningful,
        heavy: overview.capacityToday.heavy,
        blocked: overview.capacityToday.blocked,
      },
    };
  }
}
