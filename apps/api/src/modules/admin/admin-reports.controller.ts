import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { AdminReportsService } from './admin-reports.service';
import { RevenueReportQueryDto } from './dto/revenue-report-query.dto';
import { TechniciansReportQueryDto } from './dto/technicians-report-query.dto';
import { ZonesReportQueryDto } from './dto/zones-report-query.dto';

@Controller('admin')
@Roles(UserType.ADMIN)
export class AdminReportsController {
  constructor(private readonly adminReportsService: AdminReportsService) {}

  @Get('dashboard/stats')
  dashboardStats() {
    return this.adminReportsService.dashboardStats();
  }

  @Get('reports/revenue')
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
