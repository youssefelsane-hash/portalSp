import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { evaluateFormulaNode, FormulaEvaluationContext, validateFinalPriceFormulaPayload } from './formula-evaluator';
import { describeFormulaPayload, evaluateFormulaNodeWithTrace } from './formula-evaluator';
import { PricingFieldsService } from './pricing-fields.service';
import { PricingRulesService } from './pricing-rules.service';
import { ServicePricingEvaluation } from './entities/service-pricing-evaluation.entity';
import { PricingFieldType, ServicePricingField } from './entities/service-pricing-field.entity';
import { PricingRuleType } from './entities/service-pricing-rule.entity';
import {
  ConstantRulePayload,
  FinalPriceFormulaPayload,
  FormulaNode,
  LookupTableRulePayload,
  PricingEvaluationResult,
} from './pricing-formula.types';
import { PricingContext, pricingContextFormulaValues } from './pricing-context';

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
    pricingContext?: PricingContext,
  ): Promise<PricingEvaluationResult & { evaluationId: string | null }> {
    const { fieldValues, context, finalPricePayload } = await this.prepareEvaluation(serviceId, rawFieldValues, pricingContext);
    if (!finalPricePayload) {
      throw new ApiException(ErrorCode.VAL_001, 'الخدمة دي مفيهاش معادلة تسعير سارية دلوقتي', HttpStatus.CONFLICT);
    }
    const result = this.computeResult(finalPricePayload, context);

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
   * معاينة/اختبار — بدون أي كتابة في الداتابيز (لا service_pricing_evaluations ولا أي تدقيق).
   * Script 4 §47-48 (Price Engine Admin Authoring UX) — كانت فجوة موثّقة صراحة: المعاينة
   * الوحيدة الموجودة (evaluate() فوق) بتقرا القواعد **المحفوظة فعليًا** في الداتابيز، يعني
   * الأدمن مضطر يحفظ التعديل (يخليه ساري لكل عميل حقيقي فورًا) الأول قبل ما يقدر يعاين نتيجته —
   * بالظبط عكس المطلوب ("قبل النشر"). الحل: نفس محرك الحساب بالحرف، بس formula_payload ممكن
   * يتبعت override من غير ما يتخزن — لو مبعوتش، بيقرا القاعدة الحية الحالية (نفس سلوك evaluate()
   * تمامًا، مفيد لتشغيل حالات اختبار محفوظة ضد الوضع الحالي بدون تعديل).
   */
  /**
   * نسخة الإدارة من المعاينة بترجع كمان خطوات الحساب (docs/01B §5) والشرح الهيكلي (§6).
   * نفس دلالات evaluateDraft بالحرف — دي مجرد غلاف بيضيف عرضًا مساعدًا للأدمن.
   */
  async evaluateDraftDetailed(
    serviceId: string,
    rawFieldValues: Record<string, string | number | boolean>,
    formulaPayloadOverride?: Record<string, unknown>,
  ): Promise<{
    result: PricingEvaluationResult;
    trace: { path: string; expression: string; value: number }[];
    explanation: string[];
  }> {
    const payload = formulaPayloadOverride
      ? (validateFinalPriceFormulaPayload(formulaPayloadOverride), formulaPayloadOverride as unknown as FinalPriceFormulaPayload)
      : null;
    const { context, finalPricePayload } = await this.prepareEvaluation(serviceId, rawFieldValues);
    const finalPayload = payload ?? finalPricePayload;
    if (!finalPayload) {
      throw new ApiException(ErrorCode.VAL_001, 'الخدمة دي مفيهاش معادلة تسعير سارية دلوقتي', HttpStatus.CONFLICT);
    }
    // التتبع بنفس evaluator الإنتاج — القيم متطابقة بالحرف، ده عرض بس
    const traced = evaluateFormulaNodeWithTrace(finalPayload.price_cents, context);
    const result = this.computeResult(finalPayload, context);
    return { result, trace: traced.trace, explanation: describeFormulaPayload(finalPayload) };
  }

  async evaluateDraft(
    serviceId: string,
    rawFieldValues: Record<string, string | number | boolean>,
    formulaPayloadOverride?: Record<string, unknown>,
  ): Promise<PricingEvaluationResult> {
    const { context, finalPricePayload } = await this.prepareEvaluation(serviceId, rawFieldValues);
    let payload: FinalPriceFormulaPayload | null;
    if (formulaPayloadOverride) {
      validateFinalPriceFormulaPayload(formulaPayloadOverride);
      payload = formulaPayloadOverride as unknown as FinalPriceFormulaPayload;
    } else {
      payload = finalPricePayload;
    }
    if (!payload) {
      throw new ApiException(ErrorCode.VAL_001, 'الخدمة دي مفيهاش معادلة تسعير سارية دلوقتي', HttpStatus.CONFLICT);
    }
    return this.computeResult(payload, context);
  }

  private async prepareEvaluation(
    serviceId: string,
    rawFieldValues: Record<string, string | number | boolean>,
    pricingContext?: PricingContext,
  ): Promise<{
    fieldValues: Record<string, string | number | boolean>;
    context: FormulaEvaluationContext;
    finalPricePayload: FinalPriceFormulaPayload | null;
  }> {
    const fields = await this.fieldsService.listForService(serviceId);
    const activeFields = fields.filter((f) => f.isActive);
    const fieldValues = {
      ...this.validateAndNormalizeFieldValues(activeFields, rawFieldValues),
      ...(pricingContext ? pricingContextFormulaValues(pricingContext) : {}),
    };

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

    return { fieldValues, context: { fieldValues, constants, lookupTables }, finalPricePayload };
  }

  private computeResult(finalPricePayload: FinalPriceFormulaPayload, context: FormulaEvaluationContext): PricingEvaluationResult {
    const MAX_DB_INTEGER = 2_147_483_647;
    const MAX_CREW_SIZE = 1_000;
    const MAX_ESTIMATED_DURATION_DAYS = 3_660;
    const priceCents = Math.round(evaluateFormulaNode(finalPricePayload.price_cents, context));

    // Script 2 Part H (finding #44) — حراسة أخيرة على السعر النهائي قبل ما يوصل لأي مكان بيحدد
    // مبلغ حقيقي يتحصّل من العميل. field_ref (formula-evaluator.ts) بترفض القيم الغير رقمية
    // دلوقتي، لكن ده حماية إضافية ضد أي مسار حسابي تاني (lookup/constant بقيمة متطرفة، قسمة على
    // رقم قريب من صفر) ممكن نظريًا ينتج Infinity أو سعر سالب من غير ما يمر بـfield_ref خالص —
    // بدل ما نسيب Postgres يرمي "invalid input syntax for type integer" خام لو القيمة NaN وقت
    // الإدراج (orders.total_amount_cents integer)، بنرفض هنا برسالة واضحة.
    if (!Number.isSafeInteger(priceCents) || priceCents < 0 || priceCents > MAX_DB_INTEGER) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'معادلة التسعير أنتجت سعرًا غير صالح لهذه المدخلات — راجع بيانات الخدمة',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const evalOptional = (node: FormulaNode | undefined, label: string): number | null => {
      if (node === undefined) return null;
      const value = evaluateFormulaNode(node, context);
      if (!Number.isFinite(value)) {
        throw new ApiException(ErrorCode.VAL_001, `${label} الناتج من معادلة التسعير غير صالح`, HttpStatus.UNPROCESSABLE_ENTITY);
      }
      return value;
    };

    const moneyOutput = (node: FormulaNode | undefined, label: string): number | null => {
      const value = evalOptional(node, label);
      if (value === null) return null;
      const rounded = Math.round(value);
      if (rounded < 0 || rounded > MAX_DB_INTEGER) {
        throw new ApiException(ErrorCode.VAL_001, `${label} لازم يكون مبلغًا صالحًا وغير سالب`, HttpStatus.UNPROCESSABLE_ENTITY);
      }
      return rounded;
    };

    const crewOutput = (node: FormulaNode | undefined, label: string, minimum: number): number | null => {
      const value = evalOptional(node, label);
      if (value === null) return null;
      if (!Number.isSafeInteger(value) || value < minimum || value > MAX_CREW_SIZE) {
        throw new ApiException(ErrorCode.VAL_001, `${label} لازم يكون عددًا صحيحًا صالحًا`, HttpStatus.UNPROCESSABLE_ENTITY);
      }
      return value;
    };

    const minPriceCents = moneyOutput(finalPricePayload.min_price_cents, 'الحد الأدنى للسعر');
    const maxPriceCents = moneyOutput(finalPricePayload.max_price_cents, 'الحد الأقصى للسعر');
    if (minPriceCents !== null && maxPriceCents !== null && minPriceCents > maxPriceCents) {
      throw new ApiException(ErrorCode.VAL_001, 'الحد الأدنى للسعر أكبر من الحد الأقصى', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const estimatedDurationDays = evalOptional(finalPricePayload.estimated_duration_days, 'المدة المتوقعة');
    if (
      estimatedDurationDays !== null &&
      (!Number.isFinite(estimatedDurationDays) || estimatedDurationDays <= 0 || estimatedDurationDays > MAX_ESTIMATED_DURATION_DAYS)
    ) {
      throw new ApiException(ErrorCode.VAL_001, 'المدة المتوقعة الناتجة من المعادلة غير صالحة', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const requiresAssistantRaw = evalOptional(finalPricePayload.requires_assistant, 'حالة احتياج مساعد');
    const suitableForEmergencyRaw = evalOptional(finalPricePayload.suitable_for_emergency, 'ملاءمة الطوارئ');

    return {
      priceCents,
      minPriceCents,
      maxPriceCents,
      estimatedDurationDays,
      requiredTechnicians: crewOutput(finalPricePayload.required_technicians, 'عدد الفنيين', 1),
      requiredAssistants: crewOutput(finalPricePayload.required_assistants, 'عدد المساعدين', 0),
      requiresAssistant: requiresAssistantRaw !== null ? requiresAssistantRaw !== 0 : null,
      suitableForEmergency: suitableForEmergencyRaw !== null ? suitableForEmergencyRaw !== 0 : null,
    };
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

  /**
   * قيمة افتراضية لحقل اختياري متلمسش (migration `0138`). `default_value` مخزّن نص خام (نفس
   * تخزين min_value/max_value) وبيتفسّر حسب field_type. لو مفيش default_value مُعدّ صراحة:
   * حقول CHECKBOX بس بتاخد افتراض ضمني false (سلوك checkbox قياسي عالميًا — عدم التفاعل معاه
   * يعني "لأ" مش "بلا إجابة"). باقي الأنواع من غير default_value صريح تفضل زي ما هي (undefined،
   * يعني الحقل هيتجاهل تمامًا زي قبل — لو المعادلة محتاجاه هتترفض بوضوح، وده صح لأن مفيش قيمة
   * منطقية نفترضها لرقم/نص اختياري بلا default مُعدّ).
   */
  private resolveDefaultValue(field: ServicePricingField): string | number | boolean | undefined {
    if (field.defaultValue !== null) {
      if (field.fieldType === PricingFieldType.CHECKBOX) return field.defaultValue === 'true';
      if (field.fieldType === PricingFieldType.NUMBER || field.fieldType === PricingFieldType.SLIDER) {
        const numeric = Number(field.defaultValue);
        return Number.isFinite(numeric) ? numeric : field.defaultValue;
      }
      return field.defaultValue;
    }
    if (field.fieldType === PricingFieldType.CHECKBOX) return false;
    return undefined;
  }

  private validateAndNormalizeFieldValues(
    fields: ServicePricingField[],
    rawValues: Record<string, string | number | boolean>,
  ): Record<string, string | number | boolean> {
    const normalized: Record<string, string | number | boolean> = {};

    for (const field of fields) {
      let value = rawValues[field.fieldKey];
      // بَقّة حقيقية اتلقطت واتصلحت (Script 7 Phase 3): النسخة الأولى كانت بتـ`continue` فورًا
      // بمجرد ما تحسب القيمة الافتراضية، يعني default_value غير صالح (رقم بره min/max، أو قيمة
      // مش من ضمن options الحقل) كان بيتجاوز فحص الصلاحية كامل ويتحسب بيه السعر بصمت — اتأكد
      // حيًا: default_value='99999' على حقل حده الأقصى 100 كان بيطلع سعر ×999 غلط تمامًا بلا أي
      // رفض. الإصلاح: القيمة الافتراضية بتتحط في `value` وبتكمل نفس مسار فحص options/min-max
      // اللي أي قيمة مبعوتة من العميل بتتفحص بيه بالظبط — مفيش مسار "مختصر" غير محمي بعد كده.
      let usedDefault = false;
      if (value === undefined || value === null || value === '') {
        if (field.isRequired) {
          throw new ApiException(ErrorCode.VAL_001, `الحقل "${field.labelAr}" (${field.fieldKey}) مطلوب`, HttpStatus.BAD_REQUEST);
        }
        // Script 6 Part 3/4: حقل اختياري متلمسش من العميل بياخد قيمته الافتراضية (المُعدّة صراحة،
        // أو الافتراض الضمني false لحقول CHECKBOX) بدل ما يتجاهل تمامًا — لو المعادلة بتشاور عليه
        // (field_ref أو شرط)، كانت بترفض غلط بـ"الحقل مطلوب" رغم إنه مش إجباري فعلاً.
        const defaulted = this.resolveDefaultValue(field);
        if (defaulted === undefined) continue;
        value = defaulted;
        usedDefault = true;
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
            const source = usedDefault ? ' (القيمة الافتراضية المُعدّة للحقل ده مش من ضمن خياراته الحالية — لازم تتصحح من إعدادات الخدمة)' : '';
            throw new ApiException(ErrorCode.VAL_001, `قيمة غير مسموحة للحقل "${field.labelAr}": ${v}${source}`, HttpStatus.BAD_REQUEST);
          }
        }
        normalized[field.fieldKey] = values.map(String).join(',');
        continue;
      }

      if (typeof value === 'number' || (typeof value === 'string' && field.minValue !== null) || field.maxValue !== null) {
        const numericValue = Number(value);
        if (!Number.isNaN(numericValue)) {
          const source = usedDefault ? ' (القيمة الافتراضية المُعدّة للحقل ده — لازم تتصحح من إعدادات الخدمة)' : '';
          if (field.minValue !== null && numericValue < Number(field.minValue)) {
            throw new ApiException(ErrorCode.VAL_001, `قيمة "${field.labelAr}" أقل من الحد الأدنى المسموح${source}`, HttpStatus.BAD_REQUEST);
          }
          if (field.maxValue !== null && numericValue > Number(field.maxValue)) {
            throw new ApiException(ErrorCode.VAL_001, `قيمة "${field.labelAr}" أعلى من الحد الأقصى المسموح${source}`, HttpStatus.BAD_REQUEST);
          }
        }
      }

      normalized[field.fieldKey] = value;
    }

    return normalized;
  }
}
