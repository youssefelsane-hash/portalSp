import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { PricingModel, Service } from '../catalog/entities/service.entity';
import { PricingFieldType, ServicePricingField } from './entities/service-pricing-field.entity';
import { PricingRuleType } from './entities/service-pricing-rule.entity';
import { PricingFieldsService } from './pricing-fields.service';
import { PricingRulesService } from './pricing-rules.service';
import { PricingTemplateKey, pricingTemplate, pricingTemplateFinalPricePayload } from './pricing-templates';

/** المفتاح الثابت لقاعدة السعر النهائي — نفس اللي `PricingEngineService.prepareEvaluation()` بيدوّر عليه. */
const FINAL_PRICE_RULE_KEY = 'final_price';

/**
 * تطبيق قالب تسعير على خدمة (ADR-0060 §2).
 *
 * القالب **مش وضع تشغيل** — الخدمة بعد التطبيق بتبقى `formula` عادية بالكامل: حقول في
 * `service_pricing_fields` وشجرة في `service_pricing_rules`. مفيش أي فرع في الكود بعد كده
 * بيسأل «الخدمة دي كانت أنهي قالب؟»، وده بالظبط الفرق عن `pricing_model` القديم.
 */
@Injectable()
export class PricingTemplatesService {
  constructor(
    @InjectRepository(Service) private readonly services: Repository<Service>,
    @InjectRepository(ServicePricingField) private readonly fields: Repository<ServicePricingField>,
    private readonly fieldsService: PricingFieldsService,
    private readonly rulesService: PricingRulesService,
    private readonly auditLog: AuditLogService,
  ) {}

  async apply(
    adminUserId: string,
    serviceId: string,
    templateKey: PricingTemplateKey,
    rateCents: number,
    meta?: AuditActorMeta,
  ): Promise<{ created_field_keys: string[]; rule_id: string }> {
    if (!Number.isInteger(rateCents) || rateCents < 0) {
      throw new ApiException(ErrorCode.VAL_001, 'السعر لازم يكون رقم صحيح بالقرش مش أقل من صفر', HttpStatus.BAD_REQUEST);
    }
    const service = await this.services.findOne({ where: { id: serviceId, deletedAt: IsNull() } });
    if (!service) {
      throw new ApiException(ErrorCode.VAL_001, 'الخدمة غير موجودة', HttpStatus.NOT_FOUND);
    }
    if (service.pricingModel === PricingModel.INSPECTION_THEN_QUOTE) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'الخدمة دي على «كشف ثم عرض سعر» — مفيش سعر بيتحسب وقت الحجز، فمفيش قالب يتطبق عليها',
        HttpStatus.CONFLICT,
      );
    }

    const template = pricingTemplate(templateKey);

    // الحقول الأول: `PricingRulesService.upsert()` بتتحقق إن كل `field_ref` في الشجرة موجود
    // وفعّال، فأي ترتيب تاني هيرفض القاعدة.
    const createdFieldKeys: string[] = [];
    for (const field of template.fields) {
      const existing = await this.fields.findOne({
        where: { serviceId, fieldKey: field.fieldKey, deletedAt: IsNull() },
      });
      if (existing) {
        // حقل بنفس المفتاح موجود بالفعل — بنسيبه زي ما هو (ممكن الأدمن ظبط حدوده). بس لازم
        // نتأكد إنه من النوع اللي الشجرة بتتوقعه، وإلا القاعدة هتتحفظ وتغلط وقت التنفيذ.
        if (existing.fieldType !== field.fieldType) {
          throw new ApiException(
            ErrorCode.VAL_001,
            `الحقل "${field.fieldKey}" موجود بنوع مختلف (${existing.fieldType}) — امسحه أو غيّر نوعه قبل تطبيق القالب`,
            HttpStatus.CONFLICT,
          );
        }
        continue;
      }
      await this.fieldsService.create(
        adminUserId,
        serviceId,
        {
          field_key: field.fieldKey,
          label_ar: field.labelAr,
          field_type: field.fieldType,
          is_required: true,
          display_order: field.displayOrder,
          ...(field.unitAr !== null ? { unit_ar: field.unitAr } : {}),
          ...(field.minValue !== null ? { min_value: Number(field.minValue) } : {}),
          ...(field.maxValue !== null ? { max_value: Number(field.maxValue) } : {}),
        },
        meta,
      );
      createdFieldKeys.push(field.fieldKey);
    }

    const rule = await this.rulesService.upsert(
      adminUserId,
      serviceId,
      {
        rule_type: PricingRuleType.FORMULA,
        rule_key: FINAL_PRICE_RULE_KEY,
        payload: pricingTemplateFinalPricePayload(
          templateKey,
          rateCents,
          service.minPriceCents,
          service.maxPriceCents,
        ) as unknown as Record<string, unknown>,
      },
      meta,
    );

    // `base_price_cents` بيفضل مخزّن كـ«السعر اللي الأدمن دخّله» — بيظهر في الواجهة وبيستخدم
    // لو الأدمن أعاد تطبيق القالب. الحساب الفعلي بقى من الشجرة بس.
    service.pricingModel = PricingModel.FORMULA;
    service.basePriceCents = rateCents;
    await this.services.save(service);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'pricing_template.applied',
      entityType: 'service',
      entityId: serviceId,
      newValues: { template: templateKey, rate_cents: rateCents, created_field_keys: createdFieldKeys },
      meta,
    });

    return { created_field_keys: createdFieldKeys, rule_id: rule.id };
  }

  /** الحقول اللي القالب هيزرعها — للواجهة تعرض «هيتضاف كذا» قبل التأكيد. */
  previewFields(templateKey: PricingTemplateKey): { field_key: string; label_ar: string; field_type: PricingFieldType }[] {
    return pricingTemplate(templateKey).fields.map((field) => ({
      field_key: field.fieldKey,
      label_ar: field.labelAr,
      field_type: field.fieldType,
    }));
  }
}
