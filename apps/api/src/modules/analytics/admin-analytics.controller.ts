import { Body, Controller, Delete, Get, Headers, Ip, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AnalyticsRangeQueryDto, FunnelByServiceQueryDto, resolveRange } from './dto/analytics-range-query.dto';
import { UpsertMarketingSpendDto } from './dto/marketing-spend.dto';
import { ExecutiveKpisService } from './executive-kpis.service';
import { FinancialDashboardService } from './financial-dashboard.service';
import { FunnelService } from './funnel.service';
import { MarketingSpendService } from './marketing-spend.service';

/**
 * لوحة التحليلات (ADR-0081).
 *
 * تلات صلاحيات مش واحدة، ولكل واحدة سبب:
 * - `analytics.view` — تشغيلية بحتة (الفنل: فين بيتكسر الفلو). مدير العمليات محتاجها.
 * - `analytics.financial.view` — دخل الشركة وهوامشها. نفس قسمة `reports.view` /
 *   `reports.view_revenue` اللي اتعملت في 0099 لنفس السبب.
 * - `analytics.marketing_spend.manage` — **كتابة**: إنفاق التسويق مدخل بشري بيدخل في CAC.
 */
@Controller('admin/analytics')
@Roles(UserType.ADMIN)
@RequirePermission('analytics.view')
export class AdminAnalyticsController {
  constructor(
    private readonly funnel: FunnelService,
    private readonly kpis: ExecutiveKpisService,
    private readonly marketingSpend: MarketingSpendService,
    private readonly financial: FinancialDashboardService,
  ) {}

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

  @Get('executive')
  @RequirePermission('analytics.financial.view')
  executive(@Query() query: AnalyticsRangeQueryDto) {
    const { from, to } = resolveRange(query);
    return this.kpis.executiveKpis(from, to);
  }

  /** لوحة المال — كل سطر طلبه المالك، وآخر سطر فيها هو فحص التسوية. */
  @Get('money')
  @RequirePermission('analytics.financial.view')
  money(@Query() query: AnalyticsRangeQueryDto) {
    const { from, to } = resolveRange(query);
    return this.financial.moneySnapshot(from, to);
  }

  /**
   * تفاصيل مخالفات التسوية — بيترد بالمحفظة والحركة والفرق بالقرش، مش «فيه مشكلة».
   * منفصل عن `money` عشان اللوحة تفضل خفيفة والتفاصيل تتطلب لما الرقم مايبقاش صفر.
   */
  @Get('money/reconciliation')
  @RequirePermission('analytics.financial.view')
  reconciliation() {
    return this.financial.reconciliationCheck();
  }

  @Get('marketing-spend')
  @RequirePermission('analytics.financial.view')
  listSpend() {
    return this.marketingSpend.list();
  }

  @Post('marketing-spend')
  @RequirePermission('analytics.marketing_spend.manage')
  upsertSpend(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpsertMarketingSpendDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    return this.marketingSpend.upsert(user.sub, dto, { ip, userAgent: userAgent ?? null });
  }

  @Delete('marketing-spend/:id')
  @RequirePermission('analytics.marketing_spend.manage')
  async removeSpend(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    await this.marketingSpend.remove(user.sub, id, { ip, userAgent: userAgent ?? null });
    return { deleted: true };
  }
}
