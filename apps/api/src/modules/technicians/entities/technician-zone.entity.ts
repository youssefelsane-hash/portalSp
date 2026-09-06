import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق لـ infra/migrations/0005_customers_technicians.sql — مناطق عمل الفني (matching بيستخدمها
// فعلياً في findEligibleTechnicians). كانت فجوة موثّقة صراحة: التعيين كان يدوي عبر SQL مباشر
// تماماً، مفيش أي entity/endpoint ليها قبل كده.
@Entity('technician_zones')
export class TechnicianZone {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @Column({ name: 'service_zone_id', type: 'uuid' })
  serviceZoneId: string;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
