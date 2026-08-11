import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { UpsertPricingRuleDto } from './dto/upsert-pricing-rule.dto';
import { ServicePricingRule, PricingRuleType } from './entities/service-pricing-rule.entity';
import { validateFormulaNode } from './formula-evaluator';
import { FinalPriceFormulaPayload } from './pricing-formula.types';

const FINAL_PRICE_RULE_KEY = 'final_price';
const OPTIONAL_FORMULA_OUTPUT_KEYS: (keyof FinalPriceFormulaPayload)[] = [
  'min_price_cents',
  'max_price_cents',
  'estimated_duration_days',
  'required_technicians',
  'required_assistants',
  'requires_assistant',
  'suitable_for_emergency',
];

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
  if (payload.price_cents === undefined) {
    rejectPayload('formula.price_cents إجباري');
  }
  validateFormulaNode(payload.price_cents);
  for (const key of OPTIONAL_FORMULA_OUTPUT_KEYS) {
    if (payload[key] !== undefined) {
      validateFormulaNode(payload[key]);
    }
  }
}

@Injectable()
export class PricingRulesService {
  constructor(
    @InjectRepository(ServicePricingRule) private readonly rules: Repository<ServicePricingRule>,
    private readonly auditLog: AuditLogService,
  ) {}

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

  // upsert بتاريخ سريان — نفس نمط upsertZonePricing في catalog/admin-catalog.service.ts بالحرف:
  // فوري (بدون valid_from أو تاريخ ماضي) = تعديل الصف الحالي في مكانه، مستقبلي = يقفل الصف
  // الحالي (لو موجود) عند لحظة السريان الجديدة ويفتح صف جديد.
  async upsert(adminUserId: string, serviceId: string, dto: UpsertPricingRuleDto, meta?: AuditActorMeta): Promise<ServicePricingRule> {
    validateRulePayload(dto.rule_type, dto.rule_key, dto.payload);

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
