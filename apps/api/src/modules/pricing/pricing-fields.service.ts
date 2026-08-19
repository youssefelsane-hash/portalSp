import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { CreatePricingFieldDto } from './dto/create-pricing-field.dto';
import { UpdatePricingFieldDto } from './dto/update-pricing-field.dto';
import { PricingFieldType, ServicePricingField } from './entities/service-pricing-field.entity';

// أنواع حقول مش مدعومة في apps/customer-app لسه (راجع create_order_screen.dart's isSupported) —
// كانت فجوة موثّقة صراحة (مراجعة تقنية 2026-08-13): حقل إجباري من النوع ده يخلي العميل عاجز
// يكمّل الحجز خالص. الواجهة (pricing-builder.tsx) بترفض نفس الحالة قبل الإرسال — الفحص هنا
// دفاع ثاني على مستوى الباك-إند (نفس فلسفة أي تحقق حرج تاني في المشروع، الواجهة مش مصدر الحقيقة
// الوحيد).
const UNSUPPORTED_FIELD_TYPES = new Set<PricingFieldType>([
  PricingFieldType.LOCATION,
  PricingFieldType.IMAGE_UPLOAD,
  PricingFieldType.VIDEO_UPLOAD,
  PricingFieldType.VOICE_NOTE,
]);

// إدارة حقول الفورم الديناميكي لخدمة pricing_model=formula — راجع docs/08 §1.7 (مرحلة 1:
// CRUD عادي عبر REST، واجهة الأدمن Builder البصرية شغل frontend لاحق منفصل).
@Injectable()
export class PricingFieldsService {
  constructor(
    @InjectRepository(ServicePricingField) private readonly fields: Repository<ServicePricingField>,
    private readonly auditLog: AuditLogService,
  ) {}

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

    if (dto.label_ar !== undefined) field.labelAr = dto.label_ar;
    if (dto.field_type !== undefined) field.fieldType = dto.field_type;
    if (dto.is_required !== undefined) field.isRequired = dto.is_required;
    if (dto.display_order !== undefined) field.displayOrder = dto.display_order;
    if (dto.unit_ar !== undefined) field.unitAr = dto.unit_ar;
    if (dto.options !== undefined) field.options = dto.options;
    if (dto.min_value !== undefined) field.minValue = String(dto.min_value);
    if (dto.max_value !== undefined) field.maxValue = String(dto.max_value);
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
