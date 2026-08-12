import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { evaluateFormulaNode, FormulaEvaluationContext } from './formula-evaluator';
import { PricingFieldsService } from './pricing-fields.service';
import { PricingRulesService } from './pricing-rules.service';
import { ServicePricingEvaluation } from './entities/service-pricing-evaluation.entity';
import { ServicePricingField } from './entities/service-pricing-field.entity';
import { PricingRuleType } from './entities/service-pricing-rule.entity';
import {
  ConstantRulePayload,
  FinalPriceFormulaPayload,
  FormulaNode,
  LookupTableRulePayload,
  PricingEvaluationResult,
} from './pricing-formula.types';

// نقطة الدخول الوحيدة لحساب سعر خدمة pricing_model=formula — راجع docs/08 §1.5 وADR-0001.
// catalog.service.ts's estimate() بينادي عليها بس لو الخدمة formula، باقي أنواع التسعير
// (fixed/hourly/per_unit/inspection_then_quote) بتفضل شغالة بالمسار القديم زي ما هو بالظبط.
@Injectable()
export class PricingEngineService {
  constructor(
    @InjectRepository(ServicePricingEvaluation) private readonly evaluations: Repository<ServicePricingEvaluation>,
    private readonly fieldsService: PricingFieldsService,
    private readonly rulesService: PricingRulesService,
  ) {}

  async evaluate(
    serviceId: string,
    rawFieldValues: Record<string, string | number | boolean>,
    orderId?: string,
  ): Promise<PricingEvaluationResult & { evaluationId: string | null }> {
    const fields = await this.fieldsService.listForService(serviceId);
    const activeFields = fields.filter((f) => f.isActive);
    const fieldValues = this.validateAndNormalizeFieldValues(activeFields, rawFieldValues);

    const rules = await this.rulesService.listCurrentRulesForService(serviceId);
    const constants = new Map<string, ConstantRulePayload>();
    const lookupTables = new Map<string, LookupTableRulePayload>();
    let finalPricePayload: FinalPriceFormulaPayload | null = null;

    for (const rule of rules) {
      if (rule.ruleType === PricingRuleType.CONSTANT) {
        constants.set(rule.ruleKey, rule.payload as ConstantRulePayload);
      } else if (rule.ruleType === PricingRuleType.LOOKUP_TABLE) {
        lookupTables.set(rule.ruleKey, rule.payload as LookupTableRulePayload);
      } else if (rule.ruleType === PricingRuleType.FORMULA && rule.ruleKey === 'final_price') {
        finalPricePayload = rule.payload as FinalPriceFormulaPayload;
      }
    }

    if (!finalPricePayload) {
      throw new ApiException(ErrorCode.VAL_001, 'الخدمة دي مفيهاش معادلة تسعير سارية دلوقتي', HttpStatus.CONFLICT);
    }

    const context: FormulaEvaluationContext = { fieldValues, constants, lookupTables };
    const priceCents = Math.round(evaluateFormulaNode(finalPricePayload.price_cents, context));

    const evalOptional = (node: FormulaNode | undefined): number | null =>
      node !== undefined ? evaluateFormulaNode(node, context) : null;

    const requiresAssistantRaw = evalOptional(finalPricePayload.requires_assistant);
    const suitableForEmergencyRaw = evalOptional(finalPricePayload.suitable_for_emergency);

    const result: PricingEvaluationResult = {
      priceCents,
      minPriceCents: evalOptional(finalPricePayload.min_price_cents),
      maxPriceCents: evalOptional(finalPricePayload.max_price_cents),
      estimatedDurationDays: evalOptional(finalPricePayload.estimated_duration_days),
      requiredTechnicians: evalOptional(finalPricePayload.required_technicians),
      requiredAssistants: evalOptional(finalPricePayload.required_assistants),
      requiresAssistant: requiresAssistantRaw !== null ? requiresAssistantRaw !== 0 : null,
      suitableForEmergency: suitableForEmergencyRaw !== null ? suitableForEmergencyRaw !== 0 : null,
    };

    // تسجيل للتدقيق (docs/08 §1.3) — بره أي transaction، فشله ميعطلش رجوع السعر للعميل، نفس
    // فلسفة AuditLogService.record() (تسجيل التدقيق مهم بس مش أهم من العملية نفسها). الصف ده هو
    // الـsnapshot الوحيد اللي بيحفظ القيم/السعر المحسوب لحظة التقييم — لو الأدمن غيّر قواعد
    // التسعير بعد كده، الصف ده بيفضل يوضّح "السعر ده اتحسب إزاي وقتها" (تتبّع تاريخي حقيقي).
    let evaluationId: string | null = null;
    try {
      const saved = await this.evaluations.save(
        this.evaluations.create({
          serviceId,
          orderId: orderId ?? null,
          fieldValues,
          computedPriceCents: result.priceCents,
          computedDurationDays: result.estimatedDurationDays !== null ? String(result.estimatedDurationDays) : null,
          computedTechnicians: result.requiredTechnicians,
          computedAssistants: result.requiredAssistants,
        }),
      );
      evaluationId = saved.id;
    } catch {
      // تجاهل — التسجيل للتدقيق بس، مش لازم يكسر رجوع السعر الحقيقي للعميل.
    }

    return { ...result, evaluationId };
  }

  /**
   * ربط صف تدقيق تسعير موجود بالطلب اللي اتعمل منه — `evaluate()` بتتنادى قبل transaction
   * إنشاء الطلب (order.id لسه مش موجود وقتها، راجع orders/README.md)، فده بيقفل الحلقة بعد ما
   * الطلب يتأكّد فعلاً. فشل هنا (مثلاً orderId مش صحيح) **مش لازم يفشّل إنشاء الطلب نفسه** —
   * نفس فلسفة التسجيل الأصلي، تتبّع مهم بس مش أهم من العملية الحقيقية للعميل.
   */
  async linkEvaluationToOrder(evaluationId: string, orderId: string): Promise<void> {
    try {
      await this.evaluations.update({ id: evaluationId }, { orderId });
    } catch {
      // تجاهل — نفس فلسفة try/catch في evaluate() فوق.
    }
  }

  // للأدمن/التشغيل بس (docs/08 §35: وضوح الإنتاجية/المدة المتوقعة) — الـsnapshot الوحيد اللي
  // بيوضّح "المدة/عدد الفنيين/المساعدين المتوقعة لحظة الحجز" لطلب معيّن كان محسوب من formula.
  // null لأي طلب لخدمة pricing_model != formula (مفيش تقييم اتسجل خالص وقتها).
  async findEvaluationForOrder(orderId: string): Promise<ServicePricingEvaluation | null> {
    return this.evaluations.findOne({ where: { orderId }, order: { createdAt: 'DESC' } });
  }

  private validateAndNormalizeFieldValues(
    fields: ServicePricingField[],
    rawValues: Record<string, string | number | boolean>,
  ): Record<string, string | number | boolean> {
    const normalized: Record<string, string | number | boolean> = {};

    for (const field of fields) {
      const value = rawValues[field.fieldKey];
      if (value === undefined || value === null || value === '') {
        if (field.isRequired) {
          throw new ApiException(ErrorCode.VAL_001, `الحقل "${field.labelAr}" (${field.fieldKey}) مطلوب`, HttpStatus.BAD_REQUEST);
        }
        continue;
      }

      if (field.options && field.options.length > 0) {
        // multi_select بيوصل كمصفوفة من الـ DTO لكن السياق الداخلي (وشجرة المعادلة) بيتعامل
        // مع قيم سكالار بس في المرحلة الأولى دي — بنخزنها كنص مفصول بفاصلة، ومقارنات equals/
        // not_equals هتشتغل عليها كنص كامل. توسيع الدعم لمصفوفات فعلية جوّه المعادلة نفسها
        // (IN/CONTAINS) نطاق مستقل لاحق لو احتجناه.
        const values = Array.isArray(value) ? value : [value];
        const allowedValues = field.options.map((o) => o.value);
        for (const v of values) {
          if (!allowedValues.includes(String(v))) {
            throw new ApiException(ErrorCode.VAL_001, `قيمة غير مسموحة للحقل "${field.labelAr}": ${v}`, HttpStatus.BAD_REQUEST);
          }
        }
        normalized[field.fieldKey] = values.map(String).join(',');
        continue;
      }

      if (typeof value === 'number' || (typeof value === 'string' && field.minValue !== null) || field.maxValue !== null) {
        const numericValue = Number(value);
        if (!Number.isNaN(numericValue)) {
          if (field.minValue !== null && numericValue < Number(field.minValue)) {
            throw new ApiException(ErrorCode.VAL_001, `قيمة "${field.labelAr}" أقل من الحد الأدنى المسموح`, HttpStatus.BAD_REQUEST);
          }
          if (field.maxValue !== null && numericValue > Number(field.maxValue)) {
            throw new ApiException(ErrorCode.VAL_001, `قيمة "${field.labelAr}" أعلى من الحد الأقصى المسموح`, HttpStatus.BAD_REQUEST);
          }
        }
      }

      normalized[field.fieldKey] = value;
    }

    return normalized;
  }
}
