import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { TechnicianLevel } from '../../technicians/entities/technician-profile.entity';

export enum PricingModel {
  FIXED = 'fixed',
  HOURLY = 'hourly',
  PER_UNIT = 'per_unit',
  INSPECTION_THEN_QUOTE = 'inspection_then_quote',
}

@Entity('services')
export class Service {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 120 })
  nameAr: string;

  @Column({ name: 'name_en', type: 'varchar', length: 120, nullable: true })
  nameEn: string | null;

  @Column({ type: 'varchar', length: 120, unique: true })
  slug: string;

  @Column({ name: 'short_description_ar', type: 'varchar', length: 255, nullable: true })
  shortDescriptionAr: string | null;

  @Column({ name: 'full_description_ar', type: 'text', nullable: true })
  fullDescriptionAr: string | null;

  @Column({ name: 'icon_url', type: 'text', nullable: true })
  iconUrl: string | null;

  @Column({ name: 'pricing_model', type: 'enum', enum: PricingModel, enumName: 'pricing_model' })
  pricingModel: PricingModel;

  @Column({ name: 'base_price_cents', type: 'integer' })
  basePriceCents: number;

  @Column({ name: 'inspection_fee_cents', type: 'integer', default: 0 })
  inspectionFeeCents: number;

  @Column({ name: 'min_price_cents', type: 'integer', nullable: true })
  minPriceCents: number | null;

  @Column({ name: 'max_price_cents', type: 'integer', nullable: true })
  maxPriceCents: number | null;

  @Column({ name: 'unit_name_ar', type: 'varchar', length: 40, nullable: true })
  unitNameAr: string | null;

  @Column({ name: 'estimated_duration_minutes', type: 'smallint', nullable: true })
  estimatedDurationMinutes: number | null;

  @Column({ name: 'warranty_days', type: 'smallint', default: 0 })
  warrantyDays: number;

  @Column({ name: 'requires_photos', type: 'boolean', default: false })
  requiresPhotos: boolean;

  @Column({ name: 'allows_scheduling', type: 'boolean', default: true })
  allowsScheduling: boolean;

  @Column({ name: 'allows_emergency', type: 'boolean', default: false })
  allowsEmergency: boolean;

  // هيكل الحجز الجديد (docs/06 §1، docs/07 الجزء أ) — أي أوضاع حجز ("فرد"/"اعتماد") مسموحة
  // لهذه الخدمة تحديدًا. نفس نمط allows_scheduling/allows_emergency بالظبط: بديل عن قايمة
  // كاتيجوريز منفصلة لكل نوع (فجوة موثّقة اتحلّت — راجع docs/07 §الفجوات المفتوحة #1).
  @Column({ name: 'allows_individual', type: 'boolean', default: true })
  allowsIndividual: boolean;

  @Column({ name: 'allows_team', type: 'boolean', default: false })
  allowsTeam: boolean;

  @Column({
    name: 'min_technician_level',
    type: 'enum',
    enum: TechnicianLevel,
    enumName: 'technician_level',
    default: TechnicianLevel.NEW,
  })
  minTechnicianLevel: TechnicianLevel;

  @Column({ name: 'commission_percentage', type: 'numeric', precision: 5, scale: 2, default: 15.0 })
  commissionPercentage: string;

  @Column({ name: 'display_order', type: 'smallint', default: 0 })
  displayOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'launch_phase', type: 'smallint', default: 1 })
  launchPhase: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
