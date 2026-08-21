import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { TechnicianPricingTier } from '../../technicians/entities/technician-profile.entity';

// فئة تسعير الفني (docs/08 §36.24، ADR-0025) — مرآة كاملة لـservice_level_pricing، بس مربوطة
// بـTechnicianPricingTier (تجاري بحت) مش TechnicianLevel (تشغيلي). صفر تعديل على الجدول القديم.
@Entity('service_pricing_tier_pricing')
export class ServicePricingTierPricing {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'service_id', type: 'uuid' })
  serviceId: string;

  @Column({ name: 'pricing_tier', type: 'enum', enum: TechnicianPricingTier, enumName: 'technician_pricing_tier' })
  pricingTier: TechnicianPricingTier;

  @Column({ name: 'price_multiplier', type: 'numeric', precision: 4, scale: 2 })
  priceMultiplier: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
