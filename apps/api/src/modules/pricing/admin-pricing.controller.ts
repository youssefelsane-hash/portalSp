import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put , Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { ApplyPricingTemplateDto } from './dto/apply-pricing-template.dto';
import { CreatePricingFieldDto } from './dto/create-pricing-field.dto';
import { CreatePricingRuleTestDto } from './dto/create-pricing-rule-test.dto';
import { EvaluateDraftPricingDto } from './dto/evaluate-draft-pricing.dto';
import { toPricingEvaluationResponseDto, toPricingFieldResponseDto, toPricingRuleResponseDto, toPricingRuleTestResponseDto } from './dto/pricing-response.dto';
import { RunPricingRuleTestsDto } from './dto/run-pricing-rule-tests.dto';
import { UpdatePricingFieldDto } from './dto/update-pricing-field.dto';
import { UpsertPricingRuleDto } from './dto/upsert-pricing-rule.dto';
import { PricingEngineService } from './pricing-engine.service';
import { PricingFieldsService } from './pricing-fields.service';
import { PricingRulesService } from './pricing-rules.service';
import { PricingRuleTestsService } from './pricing-rule-tests.service';
import { PricingTemplatesService } from './pricing-templates.service';
import { allPricingTemplates } from './pricing-templates';

// إدارة محرك التسعير — نفس صلاحية catalog.manage الموجودة أصلاً (حقول/قواعد التسعير جزء من
// إدارة الكتالوج، مش صلاحية منفصلة، تجنّبًا لتكرار بلا داعي). راجع docs/08 §1.7: ده المرحلة 1
// (CRUD عبر REST خام)، واجهة الأدمن البصرية (Builder) شغل frontend لاحق منفصل.
@Controller('admin')
@Roles(UserType.ADMIN)
export class AdminPricingController {
  constructor(
    private readonly fieldsService: PricingFieldsService,
    private readonly rulesService: PricingRulesService,
    private readonly pricingEngineService: PricingEngineService,
    private readonly ruleTestsService: PricingRuleTestsService,
    private readonly templatesService: PricingTemplatesService,
  ) {}

  // ── قوالب التسعير (ADR-0060 §2) ─────────────────────────────────────
  //
  // القالب مش وضع تشغيل — بيزرع حقول ويكتب شجرة `final_price` مرة واحدة، وبعدها الخدمة معادلة
  // عادية بالكامل. مفيش أي فرع في الكود بيسأل «دي كانت أنهي قالب؟» بعد التطبيق.

  @Get('pricing-templates')
  listTemplates() {
    return allPricingTemplates().map((template) => ({
      key: template.key,
      label_ar: template.labelAr,
      description_ar: template.descriptionAr,
      rate_label_ar: template.rateLabelAr,
      fields: template.fields.map((field) => ({
        field_key: field.fieldKey,
        label_ar: field.labelAr,
        field_type: field.fieldType,
        unit_ar: field.unitAr,
      })),
    }));
  }

  @Post('services/:id/pricing/apply-template')
  @RequirePermission('catalog.manage')
  async applyTemplate(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyPricingTemplateDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.templatesService.apply(admin.sub, id, dto.template_key, dto.rate_cents, audit);
  }

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

  // ── معاينة/اختبار قبل النشر (Script 4 Part L §47-48) ──────────────────

  // معاينة مسوّدة — بدون أي كتابة في الداتابيز، بعكس POST /services/:id/evaluate-price
  // (pricing.controller.ts) اللي بيقرا القاعدة المحفوظة فعليًا وبيسجّل service_pricing_evaluations.
  // نفس صلاحية catalog.manage (مين يقدر يعدّل، يقدر يعاين قبل ما يحفظ).
  @Post('services/:id/pricing/evaluate-draft')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async evaluateDraft(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EvaluateDraftPricingDto) {
    const detailed = await this.pricingEngineService.evaluateDraftDetailed(id, dto.field_values, dto.formula_payload);
    // حقول اختيارية إضافية للإدارة فقط (docs/01B §5/§6) — ما تكسرش أي مستهلك قديم.
    // لو مفيش override، الـtrace/الشرح بيترسموا ضد القاعدة الحية المحفوظة نفسها.
    let trace = detailed.trace;
    let explanation = detailed.explanation;
    return { ...toPricingEvaluationResponseDto(detailed.result), trace, explanation };
  }

  /** find-usages (docs/01B §13) — إيه اللي بيستخدم حقل/ثابت/جدول بحث بالمسارات. */
  @Get('services/:id/pricing-usages')
  @RequirePermission('catalog.manage')
  async pricingUsages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('field_key') fieldKey?: string,
    @Query('rule_key') ruleKey?: string,
  ) {
    return this.rulesService.findUsages(id, { field_key: fieldKey || undefined, rule_key: ruleKey || undefined });
  }

  @Get('services/:id/pricing-tests')
  async listRuleTests(@Param('id', ParseUUIDPipe) id: string) {
    const tests = await this.ruleTestsService.listForService(id);
    return tests.map(toPricingRuleTestResponseDto);
  }

  @Post('services/:id/pricing-tests')
  @RequirePermission('catalog.manage')
  async createRuleTest(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePricingRuleTestDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toPricingRuleTestResponseDto(await this.ruleTestsService.create(admin.sub, id, dto, audit));
  }

  @Delete('services/pricing-tests/:testId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async deleteRuleTest(
    @CurrentUser() admin: JwtPayload,
    @Param('testId', ParseUUIDPipe) testId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.ruleTestsService.delete(admin.sub, testId, audit);
    return { id: testId, deleted: true };
  }

  @Post('services/:id/pricing-tests/run')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async runRuleTests(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RunPricingRuleTestsDto) {
    return this.ruleTestsService.runAll(id, dto.formula_payload);
  }
}
