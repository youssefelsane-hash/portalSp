import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AdminListProgressionQueryDto } from './dto/admin-list-progression-query.dto';
import { ApproveProgressionDto } from './dto/approve-progression.dto';
import { OverrideProgressionDto } from './dto/override-progression.dto';
import {
  toProgressionRuleResponseDto,
  toProgressionStatusResponseDto,
} from './dto/progression-response.dto';
import { RejectProgressionDto } from './dto/reject-progression.dto';
import { UpdateProgressionRuleDto } from './dto/update-progression-rule.dto';
import { TechnicianProgressionService } from './technician-progression.service';

// إدارة محرك المسار الوظيفي (docs/11 §4) — القراءة مفتوحة، الأفعال المُغيّرة محمية بصلاحيات.
@Controller('admin/technician-progression')
@Roles(UserType.ADMIN)
export class AdminTechnicianProgressionController {
  constructor(private readonly progressionService: TechnicianProgressionService) {}

  @Get('rules')
  @RequirePermission('technician_progression.view')
  async listRules() {
    const rules = await this.progressionService.listRules();
    return rules.map(toProgressionRuleResponseDto);
  }

  @Patch('rules/:id')
  @RequirePermission('technician_progression.manage_rules')
  async updateRule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProgressionRuleDto, @CurrentUser() user: JwtPayload) {
    const rule = await this.progressionService.updateRule(id, dto, user.sub);
    return toProgressionRuleResponseDto(rule);
  }

  @Post('calculate')
  @RequirePermission('technician_progression.manage_rules')
  async calculate(@Body('technician_id') technicianId?: string) {
    return this.progressionService.calculateAll(technicianId);
  }

  @Get()
  @RequirePermission('technician_progression.view')
  async list(@Query() query: AdminListProgressionQueryDto) {
    const { items, total } = await this.progressionService.listForAdmin({
      isEligible: query.is_eligible,
      needsDemotionReview: query.needs_demotion_review,
      page: query.page ?? 1,
      perPage: query.per_page ?? 20,
    });
    return {
      items: items.map(toProgressionStatusResponseDto),
      meta: { page: query.page ?? 1, per_page: query.per_page ?? 20, total },
    };
  }

  @Get(':id')
  @RequirePermission('technician_progression.view')
  async getDetail(@Param('id', ParseUUIDPipe) id: string) {
    const status = await this.progressionService.getOrThrow(id);
    return toProgressionStatusResponseDto(status);
  }

  @Patch(':id/approve')
  @RequirePermission('technician_progression.approve')
  async approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveProgressionDto, @CurrentUser() user: JwtPayload) {
    const status = await this.progressionService.approve(id, user.sub, dto.reason ?? null);
    return toProgressionStatusResponseDto(status);
  }

  @Patch(':id/override')
  @RequirePermission('technician_progression.override')
  async override(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OverrideProgressionDto, @CurrentUser() user: JwtPayload) {
    const status = await this.progressionService.override(id, user.sub, dto.reason);
    return toProgressionStatusResponseDto(status);
  }

  @Patch(':id/reject')
  @RequirePermission('technician_progression.approve')
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectProgressionDto, @CurrentUser() user: JwtPayload) {
    const status = await this.progressionService.reject(id, user.sub, dto.reason);
    return toProgressionStatusResponseDto(status);
  }
}
