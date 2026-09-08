import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { AnalyticsRangeQueryDto, FunnelByServiceQueryDto, resolveRange } from './dto/analytics-range-query.dto';
import { FunnelService } from './funnel.service';

/**
 * لوحة التحليلات (ADR-0075). كل مسار هنا **قراءة بس** — صفر كتابة على أي بيانات تشغيلية.
 *
 * `analytics.view` (migration 0273) تشغيلية: فين بيتكسر الفنل. اللوحة المالية بصلاحيتها
 * المنفصلة `analytics.financial.view` — نفس قسمة `reports.view` / `reports.view_revenue`.
 */
@Controller('admin/analytics')
@Roles(UserType.ADMIN)
@RequirePermission('analytics.view')
export class AdminAnalyticsController {
  constructor(private readonly funnel: FunnelService) {}

  @Get('funnel')
  bookingFunnel(@Query() query: AnalyticsRangeQueryDto) {
    const { from, to } = resolveRange(query);
    return this.funnel.bookingFunnel(from, to);
  }

  @Get('funnel/by-service')
  funnelByService(@Query() query: FunnelByServiceQueryDto) {
    const { from, to } = resolveRange(query);
    return this.funnel.funnelByService(from, to, query.limit ?? 20);
  }
}
