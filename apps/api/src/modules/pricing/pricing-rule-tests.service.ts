import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { CreatePricingRuleTestDto } from './dto/create-pricing-rule-test.dto';
import { PricingRuleTestRunResultDto } from './dto/pricing-response.dto';
import { ServicePricingRuleTest } from './entities/service-pricing-rule-test.entity';
import { PricingEngineService } from './pricing-engine.service';

/**
 * حالات اختبار محفوظة لمعادلة تسعير خدمة (Script 4 Part L §48) — "مدخل معيّن لازم ينتج سعر X"،
 * بتتشغّل ضد القاعدة الحية أو مسوّدة (formula_payload اختياري) عشان الأدمن يتأكد إن أي تعديل
 * مستقبلي ما كسرش سيناريو معروف قبل ما ينشره لعملاء حقيقيين.
 */
@Injectable()
export class PricingRuleTestsService {
  constructor(
    @InjectRepository(ServicePricingRuleTest) private readonly tests: Repository<ServicePricingRuleTest>,
    private readonly pricingEngineService: PricingEngineService,
    private readonly auditLog: AuditLogService,
  ) {}

  listForService(serviceId: string): Promise<ServicePricingRuleTest[]> {
    return this.tests.find({ where: { serviceId }, order: { createdAt: 'ASC' } });
  }

  async create(adminUserId: string, serviceId: string, dto: CreatePricingRuleTestDto, meta?: AuditActorMeta): Promise<ServicePricingRuleTest> {
    const test = this.tests.create({
      serviceId,
      label: dto.label,
      fieldValues: dto.field_values,
      expectedPriceCents: dto.expected_price_cents,
      createdByAdminUserId: adminUserId,
    });
    await this.tests.save(test);
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'pricing_rule_test.created',
      entityType: 'service_pricing_rule_test',
      entityId: test.id,
      newValues: { service_id: serviceId, label: dto.label, expected_price_cents: dto.expected_price_cents },
      meta,
    });
    return test;
  }

  async delete(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<void> {
    const test = await this.tests.findOne({ where: { id } });
    if (!test) {
      throw new ApiException(ErrorCode.VAL_001, 'حالة الاختبار غير موجودة', HttpStatus.NOT_FOUND);
    }
    await this.tests.remove(test);
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'pricing_rule_test.deleted',
      entityType: 'service_pricing_rule_test',
      entityId: id,
      oldValues: { service_id: test.serviceId, label: test.label },
      meta,
    });
  }

  /**
   * بتشغّل كل حالات اختبار الخدمة — formulaPayloadOverride اختياري (مسوّدة قبل الحفظ) بينادى
   * على PricingEngineService.evaluateDraft() نفسها، صفر منطق حساب مكرر. فشل حالة واحدة (مثلاً
   * حقل مطلوب ناقص في field_values المحفوظة) ما بيوقفش باقي الحالات — كل واحدة مستقلة.
   */
  async runAll(serviceId: string, formulaPayloadOverride?: Record<string, unknown>): Promise<PricingRuleTestRunResultDto[]> {
    const cases = await this.listForService(serviceId);
    const results: PricingRuleTestRunResultDto[] = [];
    for (const testCase of cases) {
      try {
        const evaluation = await this.pricingEngineService.evaluateDraft(serviceId, testCase.fieldValues, formulaPayloadOverride);
        results.push({
          id: testCase.id,
          label: testCase.label,
          expected_price_cents: testCase.expectedPriceCents,
          actual_price_cents: evaluation.priceCents,
          passed: evaluation.priceCents === testCase.expectedPriceCents,
          error: null,
        });
      } catch (err) {
        results.push({
          id: testCase.id,
          label: testCase.label,
          expected_price_cents: testCase.expectedPriceCents,
          actual_price_cents: null,
          passed: false,
          error: err instanceof ApiException ? err.message : 'خطأ غير متوقع أثناء التقييم',
        });
      }
    }
    return results;
  }
}
