import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { CreatePricingFieldDto } from './dto/create-pricing-field.dto';
import { UpdatePricingFieldDto } from './dto/update-pricing-field.dto';
import { PricingFieldType, ServicePricingField } from './entities/service-pricing-field.entity';
import { ServicePricingRule } from './entities/service-pricing-rule.entity';
import {
  indexFormulaReferences,
  loadActiveFormulaPayloads,
} from './pricing-references.util';

// أنواع حقول مش مدعومة في apps/customer-app لسه (راجع create_order_screen.dart's isSupported) —
// كانت فجوة موثّقة صراحة (مراجعة تقنية 2026-08-13): حقل إجباري من النوع ده يخلي العميل عاجز
// يكمّل الحجز خالص. الواجهة (pricing-builder.tsx) بترفض نفس الحالة قبل الإرسال — الفحص هنا
// دفاع ثاني على مستوى الباك-إند (نفس فلسفة أي تحقق حرج تاني في المشروع، الواجهة مش مصدر الحقيقة
// الوحيد).
const UNSUPPORTED_FIELD_TYPES = new Set<PricingFieldType>([
  PricingFieldType.LOCATION,
  PricingFieldType.VIDEO_UPLOAD,
  PricingFieldType.VOICE_NOTE,
]);

// إدارة حقول الفورم الديناميكي لخدمة pricing_model=formula — راجع docs/08 §1.7 (مرحلة 1:
// CRUD عادي عبر REST، واجهة الأدمن Builder البصرية شغل frontend لاحق منفصل).
@Injectable()
export class PricingFieldsService {
  constructor(
    @InjectRepository(ServicePricingField) private readonly fields: Repository<ServicePricingField>,
    @InjectRepository(ServicePricingRule) private readonly rules: Repository<ServicePricingRule>,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * حارس التغييرات التدميرية (docs/01B §14) — الحقل المستخدم في معادلة نشطة مينفعش يتشال/
   * يتعطل/يتغير نوعه، لأن ده بيكسر تسعير حقيقي للعملاء. تعديل الـlabel/الترتيب مسموح دايمًا
   * (الـlabel مش جزء من هوية المرجع في الشجرة).
   */
  private async assertFieldNotReferenced(serviceId: string, fieldKey: string, actionAr: string): Promise<void> {
    const formulas = await loadActiveFormulaPayloads(this.rules, serviceId);
    if (formulas.length === 0) return;
    const index = indexFormulaReferences(formulas);
    const usages = index.fields.get(fieldKey);
    if (usages && usages.length > 0) {
      const first = usages[0];
      throw new ApiException(
        ErrorCode.VAL_001,
        `مينفعش ${actionAr} — الحقل "${fieldKey}" مستخدم في معادلة التسعير النشطة (${usages.length} موضع، أولها: ${first.path})`,
        HttpStatus.CONFLICT,
      );
    }
  }

  listForService(serviceId: string): Promise<ServicePricingField[]> {
    return this.fields.find({ where: { serviceId }, order: { displayOrder: 'ASC' } });
  }

  private assertSupportedIfRequired(fieldType: PricingFieldType, isRequired: boolean): void {
    if (isRequired && UNSUPPORTED_FIELD_TYPES.has(fieldType)) {
      throw new ApiException(
        ErrorCode.VAL_001,
        `نوع الحقل "${fieldType}" مش مدعوم في تطبيقات العميل/الفني لسه — مينفعش يبقى إجباري`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private imageLimits(
    fieldType: PricingFieldType,
    isRequired: boolean,
    minFiles: number | undefined,
    maxFiles: number | undefined,
  ): { minFiles: number | null; maxFiles: number | null } {
    if (fieldType !== PricingFieldType.IMAGE_UPLOAD) {
      if (minFiles !== undefined || maxFiles !== undefined) {
        throw new ApiException(ErrorCode.VAL_001, 'الحد الأدنى/الأقصى للملفات متاح فقط لحقل رفع الصور', HttpStatus.BAD_REQUEST);
      }
      return { minFiles: null, maxFiles: null };
    }

    const normalizedMin = minFiles ?? (isRequired ? 1 : 0);
    const normalizedMax = maxFiles ?? 5;
    if (normalizedMin < 0 || normalizedMax < 1 || normalizedMax > 10 || normalizedMin > normalizedMax) {
      throw new ApiException(ErrorCode.VAL_001, 'عدد الصور لازم يكون بين 0 و10، والحد الأدنى مايزدش عن الأقصى', HttpStatus.BAD_REQUEST);
    }
    if (isRequired && normalizedMin < 1) {
      throw new ApiException(ErrorCode.VAL_001, 'حقل الصور الإجباري لازم يطلب صورة واحدة على الأقل', HttpStatus.BAD_REQUEST);
    }
    return { minFiles: normalizedMin, maxFiles: normalizedMax };
  }

  private async findOrThrow(id: string): Promise<ServicePricingField> {
    const field = await this.fields.findOne({ where: { id } });
    if (!field) {
      throw new ApiException(ErrorCode.VAL_001, 'حقل التسعير غير موجود', HttpStatus.NOT_FOUND);
    }
    return field;
  }

  async create(adminUserId: string, serviceId: string, dto: CreatePricingFieldDto, meta?: AuditActorMeta): Promise<ServicePricingField> {
    const existing = await this.fields.findOne({ where: { serviceId, fieldKey: dto.field_key, deletedAt: IsNull() } });
    if (existing) {
      throw new ApiException(ErrorCode.VAL_001, `field_key "${dto.field_key}" مستخدم بالفعل في الخدمة دي`, HttpStatus.CONFLICT);
    }

    this.assertSupportedIfRequired(dto.field_type, dto.is_required ?? true);
    const limits = this.imageLimits(dto.field_type, dto.is_required ?? true, dto.min_files, dto.max_files);

    const field = this.fields.create({
      serviceId,
      fieldKey: dto.field_key,
      labelAr: dto.label_ar,
      fieldType: dto.field_type,
      isRequired: dto.is_required ?? true,
      displayOrder: dto.display_order ?? 0,
      unitAr: dto.unit_ar ?? null,
      options: dto.options ?? null,
      minValue: dto.min_value !== undefined ? String(dto.min_value) : null,
      maxValue: dto.max_value !== undefined ? String(dto.max_value) : null,
      minFiles: limits.minFiles,
      maxFiles: limits.maxFiles,
      defaultValue: dto.default_value ?? null,
    });
    await this.fields.save(field);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'pricing_field.created',
      entityType: 'service_pricing_field',
      entityId: field.id,
      newValues: { service_id: serviceId, field_key: field.fieldKey, field_type: field.fieldType },
      meta,
    });
    return field;
  }

  async update(adminUserId: string, id: string, dto: UpdatePricingFieldDto, meta?: AuditActorMeta): Promise<ServicePricingField> {
    const field = await this.findOrThrow(id);
    const oldValues = { label_ar: field.labelAr, is_active: field.isActive };

    this.assertSupportedIfRequired(dto.field_type ?? field.fieldType, dto.is_required ?? field.isRequired);
    const nextFieldType = dto.field_type ?? field.fieldType;
    const nextRequired = dto.is_required ?? field.isRequired;
    const limits = this.imageLimits(
      nextFieldType,
      nextRequired,
      nextFieldType === PricingFieldType.IMAGE_UPLOAD ? (dto.min_files ?? field.minFiles ?? undefined) : dto.min_files,
      nextFieldType === PricingFieldType.IMAGE_UPLOAD ? (dto.max_files ?? field.maxFiles ?? undefined) : dto.max_files,
    );

    // حارس §14 — التعديلات دي بتغير هوية/صلاحية المرجع نفسه؛ label/display_order/is_required/unit/min/max/default مسموحين دايمًا
    const destructive =
      (dto.is_active === false && field.isActive) ||
      (dto.field_type !== undefined && dto.field_type !== field.fieldType) ||
      (dto.options !== undefined &&
        Array.isArray(field.options) &&
        Array.isArray(dto.options) &&
        // تقليص الخيارات: خيار قائم قيمته اختفت من القايمة الجديدة — ممكن يكسر if/lookup عليه
        (field.options as { value: string }[]).some((existing) =>
          !(dto.options as { value: string }[]).some((incoming) => incoming.value === existing.value),
        ));
    if (destructive) {
      await this.assertFieldNotReferenced(
        field.serviceId,
        field.fieldKey,
        dto.is_active === false ? 'تعطّل الحقل ده' : 'تغيّر نوع/خيارات الحقل ده',
      );
    }

    if (dto.label_ar !== undefined) field.labelAr = dto.label_ar;
    if (dto.field_type !== undefined) field.fieldType = dto.field_type;
    if (dto.is_required !== undefined) field.isRequired = dto.is_required;
    if (dto.display_order !== undefined) field.displayOrder = dto.display_order;
    if (dto.unit_ar !== undefined) field.unitAr = dto.unit_ar;
    if (dto.options !== undefined) field.options = dto.options;
    if (dto.min_value !== undefined) field.minValue = String(dto.min_value);
    if (dto.max_value !== undefined) field.maxValue = String(dto.max_value);
    field.minFiles = limits.minFiles;
    field.maxFiles = limits.maxFiles;
    if (dto.default_value !== undefined) field.defaultValue = dto.default_value;
    if (dto.is_active !== undefined) field.isActive = dto.is_active;
    await this.fields.save(field);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'pricing_field.updated',
      entityType: 'service_pricing_field',
      entityId: field.id,
      oldValues,
      newValues: { label_ar: field.labelAr, is_active: field.isActive },
      meta,
    });
    return field;
  }

  async delete(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<void> {
    const field = await this.findOrThrow(id);
    await this.assertFieldNotReferenced(field.serviceId, field.fieldKey, 'تحذف الحقل ده');
    await this.fields.softDelete(id);
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'pricing_field.deleted',
      entityType: 'service_pricing_field',
      entityId: id,
      oldValues: { field_key: field.fieldKey },
      meta,
    });
  }
}
