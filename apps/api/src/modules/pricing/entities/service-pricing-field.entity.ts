import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum PricingFieldType {
  NUMBER = 'number',
  DROPDOWN = 'dropdown',
  MULTI_SELECT = 'multi_select',
  CHECKBOX = 'checkbox',
  SLIDER = 'slider',
  AREA = 'area',
  LENGTH = 'length',
  VOLUME = 'volume',
  DATE = 'date',
  TIME = 'time',
  LOCATION = 'location',
  IMAGE_UPLOAD = 'image_upload',
  VIDEO_UPLOAD = 'video_upload',
  VOICE_NOTE = 'voice_note',
}

export interface PricingFieldOption {
  value: string;
  label_ar: string;
}

// حقل واحد في الفورم الديناميكي لخدمة pricing_model=formula — راجع docs/08 §1.4 وADR-0001.
@Entity('service_pricing_fields')
export class ServicePricingField {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'service_id', type: 'uuid' })
  serviceId: string;

  @Column({ name: 'field_key', type: 'varchar', length: 60 })
  fieldKey: string;

  @Column({ name: 'label_ar', type: 'varchar', length: 120 })
  labelAr: string;

  @Column({ name: 'field_type', type: 'enum', enum: PricingFieldType, enumName: 'pricing_field_type' })
  fieldType: PricingFieldType;

  @Column({ name: 'is_required', type: 'boolean', default: true })
  isRequired: boolean;

  @Column({ name: 'display_order', type: 'smallint', default: 0 })
  displayOrder: number;

  @Column({ name: 'unit_ar', type: 'varchar', length: 20, nullable: true })
  unitAr: string | null;

  @Column({ type: 'jsonb', nullable: true })
  options: PricingFieldOption[] | null;

  @Column({ name: 'min_value', type: 'numeric', precision: 12, scale: 2, nullable: true })
  minValue: string | null;

  @Column({ name: 'max_value', type: 'numeric', precision: 12, scale: 2, nullable: true })
  maxValue: string | null;

  // قيمة افتراضية اختيارية (Script 6 Part 3/4) — نص خام بيتفسّر حسب field_type وقت الاستخدام.
  // لحقول CHECKBOX بلا default_value صريح هنا، الافتراض الضمني false — راجع
  // PricingEngineService.validateAndNormalizeFieldValues().
  @Column({ name: 'default_value', type: 'text', nullable: true })
  defaultValue: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
