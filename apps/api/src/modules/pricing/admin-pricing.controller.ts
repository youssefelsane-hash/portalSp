import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { CreatePricingFieldDto } from './dto/create-pricing-field.dto';
import { toPricingFieldResponseDto, toPricingRuleResponseDto } from './dto/pricing-response.dto';
import { UpdatePricingFieldDto } from './dto/update-pricing-field.dto';
import { UpsertPricingRuleDto } from './dto/upsert-pricing-rule.dto';
import { PricingFieldsService } from './pricing-fields.service';
import { PricingRulesService } from './pricing-rules.service';

// إدارة محرك التسعير — نفس صلاحية catalog.manage الموجودة أصلاً (حقول/قواعد التسعير جزء من
// إدارة الكتالوج، مش صلاحية منفصلة، تجنّبًا لتكرار بلا داعي). راجع docs/08 §1.7: ده المرحلة 1
// (CRUD عبر REST خام)، واجهة الأدمن البصرية (Builder) شغل frontend لاحق منفصل.
@Controller('admin')
@Roles(UserType.ADMIN)
export class AdminPricingController {
  constructor(
    private readonly fieldsService: PricingFieldsService,
    private readonly rulesService: PricingRulesService,
  ) {}

  // ── حقول الفورم الديناميكي ──────────────────────────────────────────

  @Get('services/:id/pricing-fields')
  async listFields(@Param('id', ParseUUIDPipe) id: string) {
    const fields = await this.fieldsService.listForService(id);
    return fields.map(toPricingFieldResponseDto);
  }

  @Post('services/:id/pricing-fields')
  @RequirePermission('catalog.manage')
  async createField(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePricingFieldDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toPricingFieldResponseDto(await this.fieldsService.create(admin.sub, id, dto, audit));
  }

  @Patch('services/pricing-fields/:fieldId')
  @RequirePermission('catalog.manage')
  async updateField(
    @CurrentUser() admin: JwtPayload,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Body() dto: UpdatePricingFieldDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toPricingFieldResponseDto(await this.fieldsService.update(admin.sub, fieldId, dto, audit));
  }

  @Delete('services/pricing-fields/:fieldId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async deleteField(
    @CurrentUser() admin: JwtPayload,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.fieldsService.delete(admin.sub, fieldId, audit);
    return { id: fieldId, deleted: true };
  }

  // ── قواعد التسعير (ثوابت/جداول بحث/المعادلة النهائية) ────────────────

  @Get('services/:id/pricing-rules')
  async listRules(@Param('id', ParseUUIDPipe) id: string) {
    const rules = await this.rulesService.listForService(id);
    return rules.map(toPricingRuleResponseDto);
  }

  @Put('services/:id/pricing-rules')
  @RequirePermission('catalog.manage')
  async upsertRule(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertPricingRuleDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toPricingRuleResponseDto(await this.rulesService.upsert(admin.sub, id, dto, audit));
  }

  @Delete('services/pricing-rules/:ruleId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async deactivateRule(
    @CurrentUser() admin: JwtPayload,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.rulesService.deactivate(admin.sub, ruleId, audit);
    return { id: ruleId, deactivated: true };
  }
}
