import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { AdminReportsService } from './admin-reports.service';
import { RevenueReportQueryDto } from './dto/revenue-report-query.dto';
import { TechniciansReportQueryDto } from './dto/technicians-report-query.dto';
import { ZonesReportQueryDto } from './dto/zones-report-query.dto';

// بَقّة أمنية حقيقية اتلقطت واتصلحت (مراجعة أمان شاملة 2026-08-13، P0-2): الكنترولر ده كان
// محمي بـ@Roles(ADMIN) بس — أي حساب أدمن (حتى support_agent بلا أي دور تشغيلي) كان يقدر يشوف
// الداشبورد/الإيراد/تقارير الفنيين والمناطق. reports.view جديدة (migration 0085)، ممنوحة
// افتراضيًا لـops_manager/finance (super_admin بياخدها أوتوماتيك عن طريق is_super_admin bypass).
//
// بَقّة أمنية تانية اتصلحت لاحقًا (docs/08 §19 بند 8): reports.view واحدة كانت بتغطي الإيراد
// المالي (revenueReport) والتقارير التشغيلية (dashboard/technicians/zones) مع بعض — يعني
// ops_manager (اللي محتاج التقارير التشغيلية فعلاً) كان يقدر يشوف إيراد الشركة كمان، رغم إن ده
// بيانات مالية حساسة المفروض تبقى default-deny. reports.view_revenue جديدة (migration 0099)،
// ممنوحة لـfinance بس — reports.view الأصلية فضلت زي ما هي لباقي الـendpoints التشغيلية.
@Controller('admin')
@Roles(UserType.ADMIN)
@RequirePermission('reports.view')
export class AdminReportsController {
  constructor(private readonly adminReportsService: AdminReportsService) {}

  @Get('dashboard/stats')
  dashboardStats() {
    return this.adminReportsService.dashboardStats();
  }

  @Get('reports/revenue')
  @RequirePermission('reports.view_revenue')
  revenueReport(@Query() query: RevenueReportQueryDto) {
    return this.adminReportsService.revenueByPeriod(query);
  }

  @Get('reports/technicians')
  techniciansReport(@Query() query: TechniciansReportQueryDto) {
    return this.adminReportsService.techniciansReport(query);
  }

  @Get('reports/zones')
  zonesReport(@Query() query: ZonesReportQueryDto) {
    return this.adminReportsService.zonesReport(query);
  }
}
