import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AdminEarningsPolicyService } from './admin-earnings-policy.service';
import {
  CreateTechnicianEarningAdjustmentDto,
  SetEarningsCutoverDto,
  SimulateEarningsDto,
  UpdateEarningsLevelPolicyDto,
  UpdateEarningsSkillPolicyDto,
  UpdateFixedCommissionDto,
  ResetEarningsOverrideDto,
  UpdateServiceLevelEarningsOverrideDto,
  UpdateServiceSkillEarningsOverrideDto,
} from './dto/earnings-policy.dto';

@Controller('admin/earnings-policy')
@Roles(UserType.ADMIN)
export class AdminEarningsPolicyController {
  constructor(private readonly policy: AdminEarningsPolicyService) {}

  @Get()
  @RequirePermission('earnings_policy.view')
  overview() {
    return this.policy.overview();
  }

  @Patch('services/:id/commission')
  @RequirePermission('earnings_policy.manage')
  @RequireStepUp()
  updateCommission(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFixedCommissionDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.policy.updateServiceCommission(user.sub, id, dto, audit);
  }

  @Patch('levels/:level')
  @RequirePermission('earnings_policy.manage')
  @RequireStepUp()
  updateLevel(
    @CurrentUser() user: JwtPayload,
    @Param('level') level: string,
    @Body() dto: UpdateEarningsLevelPolicyDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.policy.updateLevel(user.sub, level, dto, audit);
  }

  @Patch('skills/:skill')
  @RequirePermission('earnings_policy.manage')
  @RequireStepUp()
  updateSkill(
    @CurrentUser() user: JwtPayload,
    @Param('skill') skill: string,
    @Body() dto: UpdateEarningsSkillPolicyDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.policy.updateSkill(user.sub, skill, dto, audit);
  }

  @Post('cutover')
  @RequirePermission('earnings_policy.manage')
  @RequireStepUp()
  cutover(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetEarningsCutoverDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.policy.setCutover(user.sub, dto.enabled, dto.reason, audit);
  }

  @Post('simulate')
  @RequirePermission('earnings_policy.view')
  simulate(@Body() dto: SimulateEarningsDto) {
    return this.policy.simulate(dto);
  }

  @Post('technicians/:id/adjustments')
  @RequirePermission('technician_earning_adjustment.manage')
  @RequireStepUp()
  createAdjustment(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTechnicianEarningAdjustmentDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.policy.createTechnicianAdjustment(user.sub, id, dto, audit);
  }

  @Put('services/:id/levels/:level')
  @RequirePermission('earnings_policy.manage')
  @RequireStepUp()
  upsertServiceLevel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level') level: string,
    @Body() dto: UpdateServiceLevelEarningsOverrideDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.policy.upsertServiceLevelOverride(user.sub, id, level, dto, audit);
  }

  @Delete('services/:id/levels/:level')
  @RequirePermission('earnings_policy.manage')
  @RequireStepUp()
  resetServiceLevel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level') level: string,
    @Body() dto: ResetEarningsOverrideDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.policy.resetServiceOverride(user.sub, 'service_earnings_level_overrides', id, level, dto.reason, audit);
  }

  @Put('services/:id/skills/:skill')
  @RequirePermission('earnings_policy.manage')
  @RequireStepUp()
  upsertServiceSkill(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('skill') skill: string,
    @Body() dto: UpdateServiceSkillEarningsOverrideDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.policy.upsertServiceSkillOverride(user.sub, id, skill, dto, audit);
  }

  @Delete('services/:id/skills/:skill')
  @RequirePermission('earnings_policy.manage')
  @RequireStepUp()
  resetServiceSkill(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('skill') skill: string,
    @Body() dto: ResetEarningsOverrideDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.policy.resetServiceOverride(user.sub, 'service_earnings_skill_overrides', id, skill, dto.reason, audit);
  }
}
