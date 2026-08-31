import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { UpsertPricingRuleDto } from './dto/upsert-pricing-rule.dto';
import { ServicePricingField } from './entities/service-pricing-field.entity';
import { ServicePricingRule, PricingRuleType } from './entities/service-pricing-rule.entity';
import { collectFormulaReferences } from './formula-evaluator';
import {
  FormulaReferenceIndex,
  indexFormulaReferences,
  loadActiveFormulaPayloads,
} from './pricing-references.util';
import { validateFinalPriceFormulaPayload } from './formula-evaluator';
import { PRICING_CONTEXT_FIELD_KEYS } from './pricing-context';

const FINAL_PRICE_RULE_KEY = 'final_price';

function rejectPayload(reason: string): never {
  throw new ApiException(ErrorCode.VAL_001, `payload غير صالح: ${reason}`, HttpStatus.BAD_REQUEST);
}

/**
 * فحص شكل payload حسب ruleType — منفصل عن validateFormulaNode لأن ده بيفحص "شكل الصف نفسه"
 * (فيه price_cents؟ الـvalues أرقام؟) بينما validateFormulaNode بيفحص "شجرة العمليات جوّه
 * كل formula field" بالتفصيل. الاتنين لازم يعدّوا قبل ما أي rule تتخزن.
 */
function validateRulePayload(ruleType: PricingRuleType, ruleKey: string, payload: Record<string, unknown>): void {
  if (ruleType === PricingRuleType.CONSTANT) {
    if (typeof payload.value !== 'number' || !Number.isFinite(payload.value)) {
      rejectPayload('constant.value لازم يكون رقم');
    }
    return;
  }

  if (ruleType === PricingRuleType.LOOKUP_TABLE) {
    if (typeof payload.field_key !== 'string' || payload.field_key.length === 0) {
      rejectPayload('lookup_table.field_key لازم يكون نص غير فاضي');
    }
    if (typeof payload.values !== 'object' || payload.values === null || Array.isArray(payload.values)) {
      rejectPayload('lookup_table.values لازم يكون object');
    }
    for (const [key, value] of Object.entries(payload.values as Record<string, unknown>)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        rejectPayload(`lookup_table.values["${key}"] لازم يكون رقم`);
      }
    }
    return;
  }

  // formula
  if (ruleKey !== FINAL_PRICE_RULE_KEY) {
    rejectPayload(`rule_type=formula لازم يكون rule_key="${FINAL_PRICE_RULE_KEY}"`);
  }
  validateFinalPriceFormulaPayload(payload);
}

@Injectable()
export class PricingRulesService {
  constructor(
    @InjectRepository(ServicePricingRule) private readonly rules: Repository<ServicePricingRule>,
    @InjectRepository(ServicePricingField) private readonly fields: Repository<ServicePricingField>,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * فحص مراجع المعادلة ضد تهيئة الخدمة الفعلية (docs/01B §8) — حقل متمسوح/معطّل، ثابت أو
   * جدول بحث مش موجود، أو lookup مربوط بحقل مختلف — كلهم بيترفضوا وقت الحفظ برسالة بتوضّح
   * **مكان** المرجع في الشجرة، بدل ما الطلب الحقيقي يفشل بعيد عند العميل.
   *
   * بيتنادى بس من upsert() للـrule_type=formula — المعاينة (evaluateDraft) متعمّدًا بتفحص
   * الشكل بس عشان تسمح بتجربة مراجع لسه هتتعمل قبل الحفظ.
   */
  private async assertFormulaReferencesValid(serviceId: string, payload: Record<string, unknown>): Promise<void> {
    const refs = collectFormulaReferences(payload as never);
    if (refs.length === 0) return;

    // الحقول النشطة للخدمة (machine keys)
    const activeFields = await this.fields.find({ where: { serviceId, isActive: true } });
    const activeFieldKeys = new Set(activeFields.map((f) => f.fieldKey));

    // الثوابت/جداول البحث السارية للخدمة
    const currentRules = await this.listCurrentRulesForService(serviceId);
    const constantKeys = new Set(currentRules.filter((r) => r.ruleType === PricingRuleType.CONSTANT).map((r) => r.ruleKey));
    const lookupTables = new Map(
      currentRules.filter((r) => r.ruleType === PricingRuleType.LOOKUP_TABLE).map((r) => [r.ruleKey, r.payload as { field_key: string }]),
    );

    for (const ref of refs) {
      switch (ref.kind) {
        case 'field':
          if (!activeFieldKeys.has(ref.key) && !PRICING_CONTEXT_FIELD_KEYS.has(ref.key)) {
            throw new ApiException(
              ErrorCode.VAL_001,
              `${ref.path}: الحقل "${ref.key}" مش من ضمن حقول الخدمة النشطة — عدّل المرجع أو فعّل الحقل`,
              HttpStatus.BAD_REQUEST,
            );
          }
          break;
        case 'constant':
          if (!constantKeys.has(ref.key)) {
            throw new ApiException(
              ErrorCode.VAL_001,
              `${ref.path}: الثابت "${ref.key}" غير موجود/غير ساري لهذه الخدمة`,
              HttpStatus.BAD_REQUEST,
            );
          }
          break;
        case 'lookup': {
          const table = lookupTables.get(ref.key);
          if (!table) {
            throw new ApiException(
              ErrorCode.VAL_001,
              `${ref.path}: جدول البحث "${ref.key}" غير موجود/غير ساري لهذه الخدمة`,
              HttpStatus.BAD_REQUEST,
            );
          }
          break;
        }
        case 'lookup_bound_field': {
          // ربط الجدول لازم يكون لحقل نشط — لو الجدول نفسه موجود وربطه مختلف بنرفض هنا كمان
          const table = lookupTables.get(ref.extraKey ?? '');
          if (activeFieldKeys.size > 0 && !activeFieldKeys.has(ref.key)) {
            throw new ApiException(
              ErrorCode.VAL_001,
              `${ref.path}: جدول البحث "${ref.extraKey}" مربوط بحقل "${ref.key}" مش من ضمن حقول الخدمة النشطة${
                table && table.field_key !== ref.key ? ' — والربط المحفوظ في الجدول نفسه مختلف عنه' : ''
              }`,
              HttpStatus.BAD_REQUEST,
            );
          }
          break;
        }
      }
    }
  }

  listForService(serviceId: string): Promise<ServicePricingRule[]> {
    return this.rules.find({ where: { serviceId }, order: { ruleType: 'ASC', displayOrder: 'ASC' } });
  }

  /** القاعدة السارية دلوقتي لـ (serviceId, ruleKey) — نفس فلسفة findCurrentZonePricing بالحرف. */
  async findCurrentRule(serviceId: string, ruleType: PricingRuleType, ruleKey: string, at: Date = new Date()): Promise<ServicePricingRule | null> {
    return this.rules
      .createQueryBuilder('r')
      .where('r.serviceId = :serviceId', { serviceId })
      .andWhere('r.ruleType = :ruleType', { ruleType })
      .andWhere('r.ruleKey = :ruleKey', { ruleKey })
      .andWhere('r.isActive = true')
      .andWhere('r.validFrom <= :at', { at })
      .andWhere('(r.validUntil IS NULL OR r.validUntil > :at)')
      .getOne();
  }

  /** كل القواعد السارية دلوقتي لخدمة معيّنة — بيتنادى من PricingEngineService.evaluate(). */
  async listCurrentRulesForService(serviceId: string, at: Date = new Date()): Promise<ServicePricingRule[]> {
    return this.rules
      .createQueryBuilder('r')
      .where('r.serviceId = :serviceId', { serviceId })
      .andWhere('r.isActive = true')
      .andWhere('r.validFrom <= :at', { at })
      .andWhere('(r.validUntil IS NULL OR r.validUntil > :at)')
      .getMany();
  }

  /**
   * فهرس مراجع معادلات الخدمة النشطة (docs/01B §8/§13) — بيفحصه deactivate() قبل ما يسمح
   * بتعطيل ثابت/جدول بحث مستخدم، وبيغذي endpoint find-usages للواجهة.
   */
  async buildReferenceIndex(serviceId: string): Promise<FormulaReferenceIndex> {
    const formulas = await loadActiveFormulaPayloads(this.rules, serviceId);
    return indexFormulaReferences(formulas);
  }

  /** find-usages — إيه اللي بيستخدم الحقل/الثابت/الجدول ده بالمسارات. */
  async findUsages(
    serviceId: string,
    target: { field_key?: string; rule_key?: string },
  ): Promise<{ target: Record<string, string | undefined>; matches: { rule_id: string; rule_key: string; kind: string; path: string }[] }> {
    const index = await this.buildReferenceIndex(serviceId);
    const matches: { rule_id: string; rule_key: string; kind: string; path: string }[] = [];
    if (target.field_key) {
      for (const loc of index.fields.get(target.field_key) ?? []) {
        matches.push({ rule_id: loc.ruleId, rule_key: loc.ruleKey, kind: loc.kind, path: loc.path });
      }
    }
    if (target.rule_key) {
      for (const loc of index.constants.get(target.rule_key) ?? []) {
        matches.push({ rule_id: loc.ruleId, rule_key: loc.ruleKey, kind: 'constant', path: loc.path });
      }
      for (const loc of index.lookups.get(target.rule_key) ?? []) {
        matches.push({ rule_id: loc.ruleId, rule_key: loc.ruleKey, kind: 'lookup', path: loc.path });
      }
    }
    return { target, matches };
  }

  // upsert بتاريخ سريان — نفس نمط upsertZonePricing في catalog/admin-catalog.service.ts بالحرف:
  // فوري (بدون valid_from أو تاريخ ماضي) = تعديل الصف الحالي في مكانه، مستقبلي = يقفل الصف
  // الحالي (لو موجود) عند لحظة السريان الجديدة ويفتح صف جديد.
  async upsert(adminUserId: string, serviceId: string, dto: UpsertPricingRuleDto, meta?: AuditActorMeta): Promise<ServicePricingRule> {
    validateRulePayload(dto.rule_type, dto.rule_key, dto.payload);
    if (dto.rule_type === PricingRuleType.FORMULA) {
      await this.assertFormulaReferencesValid(serviceId, dto.payload);
    }

    const now = new Date();
    const validFrom = dto.valid_from ? new Date(dto.valid_from) : now;
    const isFutureScheduling = validFrom.getTime() > now.getTime();

    const current = await this.findCurrentRule(serviceId, dto.rule_type, dto.rule_key);

    let rule: ServicePricingRule;
    let isNew: boolean;
    if (isFutureScheduling) {
      if (current) {
        current.validUntil = validFrom;
        await this.rules.save(current);
      }
      rule = this.rules.create({ serviceId, ruleType: dto.rule_type, ruleKey: dto.rule_key, validFrom, validUntil: null });
      isNew = true;
    } else if (current) {
      rule = current;
      isNew = false;
    } else {
      rule = this.rules.create({ serviceId, ruleType: dto.rule_type, ruleKey: dto.rule_key, validFrom, validUntil: null });
      isNew = true;
    }

    rule.payload = dto.payload;
    if (dto.display_order !== undefined) rule.displayOrder = dto.display_order;
    await this.rules.save(rule);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: isNew ? 'pricing_rule.created' : 'pricing_rule.updated',
      entityType: 'service_pricing_rule',
      entityId: rule.id,
      newValues: { service_id: serviceId, rule_type: rule.ruleType, rule_key: rule.ruleKey },
      meta,
    });
    return rule;
  }

  async deactivate(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<void> {
    const rule = await this.rules.findOne({ where: { id } });
    if (!rule) {
      throw new ApiException(ErrorCode.VAL_001, 'قاعدة التسعير غير موجودة', HttpStatus.NOT_FOUND);
    }
    // حارس §13 — تعطيل ثابت/جدول بحث مستخدم في معادلة نشطة = كسر تسعير بصمت؛ بنمنعه صراحة
    // بمسار الاستخدام الأول. المعادلة نفسها (formula) تعطيلها مسموح دايمًا.
    if (rule.ruleType === PricingRuleType.CONSTANT || rule.ruleType === PricingRuleType.LOOKUP_TABLE) {
      const index = await this.buildReferenceIndex(rule.serviceId);
      const usages =
        rule.ruleType === PricingRuleType.CONSTANT
          ? index.constants.get(rule.ruleKey)
          : index.lookups.get(rule.ruleKey);
      if (usages && usages.length > 0 && !(usages.length === 1 && usages[0].ruleId === rule.id)) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `مينفعش تعطّل "${rule.ruleKey}" — مستخدم في ${usages.length} موضع في معادلات نشطة (أولها: ${usages[0].path}). عدّل المعادلة الأولى.`,
          HttpStatus.CONFLICT,
        );
      }
    }
    rule.isActive = false;
    await this.rules.save(rule);
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'pricing_rule.deactivated',
      entityType: 'service_pricing_rule',
      entityId: id,
      oldValues: { rule_key: rule.ruleKey },
      meta,
    });
  }
}
