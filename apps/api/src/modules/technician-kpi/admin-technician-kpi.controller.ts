import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AdminListKpiQueryDto } from './dto/admin-list-kpi-query.dto';
import { ApproveKpiDto } from './dto/approve-kpi.dto';
import { CalculateKpiDto } from './dto/calculate-kpi.dto';
import { RejectKpiDto } from './dto/reject-kpi.dto';
import { toTechnicianKpiSnapshotResponseDto } from './dto/technician-kpi-response.dto';
import { TechnicianKpiService } from './technician-kpi.service';

// إدارة الـKPI الشهري (docs/11 §3) — القراءة مفتوحة لأي أدمن، الأفعال المُغيّرة (حساب/موافقة/
// رفض/صرف) محمية بصلاحيات دقيقة (نفس فلسفة roles.manage/technicians.manage_zones).
@Controller('admin/technician-kpi')
@Roles(UserType.ADMIN)
export class AdminTechnicianKpiController {
  constructor(private readonly kpiService: TechnicianKpiService) {}

  @Post('calculate')
  @RequirePermission('technician_kpi.calculate')
  async calculate(@Body() dto: CalculateKpiDto) {
    return this.kpiService.calculateForPeriod(dto.period_year, dto.period_month, dto.technician_id);
  }

  @Get()
  async list(@Query() query: AdminListKpiQueryDto) {
    const { items, total } = await this.kpiService.listForAdmin({
      periodYear: query.period_year,
      periodMonth: query.period_month,
      technicianId: query.technician_id,
      status: query.status,
      page: query.page ?? 1,
      perPage: query.per_page ?? 20,
    });
    return {
      items: items.map((s) => toTechnicianKpiSnapshotResponseDto(s)),
      meta: { page: query.page ?? 1, per_page: query.per_page ?? 20, total },
    };
  }

  @Get(':id')
  async getDetail(@Param('id', ParseUUIDPipe) id: string) {
    const snapshot = await this.kpiService.getOrThrow(id);
    return toTechnicianKpiSnapshotResponseDto(snapshot);
  }

  @Get('technicians/:id/history')
  async getTechnicianHistory(@Param('id', ParseUUIDPipe) id: string) {
    const { latest, history } = await this.kpiService.getTechnicianSummary(id);
    return {
      latest: latest ? toTechnicianKpiSnapshotResponseDto(latest) : null,
      history: history.map((s) => toTechnicianKpiSnapshotResponseDto(s)),
    };
  }

  @Patch(':id/approve')
  @RequirePermission('technician_kpi.approve')
  async approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveKpiDto, @CurrentUser() user: JwtPayload) {
    const snapshot = await this.kpiService.approve(id, user.sub, dto.approved_bonus_cents, dto.notes ?? null);
    return toTechnicianKpiSnapshotResponseDto(snapshot);
  }

  @Patch(':id/reject')
  @RequirePermission('technician_kpi.approve')
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectKpiDto, @CurrentUser() user: JwtPayload) {
    const snapshot = await this.kpiService.reject(id, user.sub, dto.reason);
    return toTechnicianKpiSnapshotResponseDto(snapshot);
  }

  @Post(':id/pay')
  @RequirePermission('technician_kpi.approve')
  async pay(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    const snapshot = await this.kpiService.pay(id, user.sub);
    return toTechnicianKpiSnapshotResponseDto(snapshot);
  }
}
