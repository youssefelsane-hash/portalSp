import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { AdminOperationsOverviewService } from './admin-operations-overview.service';
import { AdminWorkloadForecastService } from './admin-workload-forecast.service';
import { OperationsOverviewQueryDto } from './dto/operations-overview-query.dto';
import { WorkloadForecastQueryDto } from './dto/workload-forecast-query.dto';

// مركز العمليات (docs/08 §36.2 فصاعدًا) — بداية قسم جديد كامل بيتوسّع مرحلة بمرحلة (§36.3-14).
@Controller('admin/operations')
@Roles(UserType.ADMIN)
export class AdminOperationsController {
  constructor(
    private readonly overviewService: AdminOperationsOverviewService,
    private readonly workloadForecastService: AdminWorkloadForecastService,
  ) {}

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

  // عرض الحمل القريب — 7 أيام (docs/08 §36.4). بلا RequirePermission مخصوصة، نفس مستوى overview/
  // by-category (عرض/تشخيص بس).
  @Get('workload-forecast')
  async getWorkloadForecast(@Query() query: WorkloadForecastQueryDto) {
    const { items, meta } = await this.workloadForecastService.getForecast({
      categoryId: query.category_id,
      zoneId: query.zone_id ?? null,
      page: query.page ?? 1,
      perPage: query.per_page ?? 20,
    });
    return {
      items: items.map((r) => ({
        id: r.id,
        technician_code: r.technicianCode,
        full_name: r.fullName,
        current_level: r.currentLevel,
        days: r.days.map((d) => ({ date: d.date, tier: d.tier, is_multi_day: d.isMultiDay })),
      })),
      meta,
    };
  }
}
