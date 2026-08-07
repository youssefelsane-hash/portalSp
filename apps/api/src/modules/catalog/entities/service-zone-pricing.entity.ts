import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('service_zone_pricing')
export class ServiceZonePricing {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'service_id', type: 'uuid' })
  serviceId: string;

  @Column({ name: 'service_zone_id', type: 'uuid' })
  serviceZoneId: string;

  @Column({ name: 'price_cents', type: 'integer' })
  priceCents: number;

  @Column({ name: 'inspection_fee_cents', type: 'integer', default: 0 })
  inspectionFeeCents: number;

  @Column({ name: 'surge_multiplier', type: 'numeric', precision: 4, scale: 2, default: 1.0 })
  surgeMultiplier: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
