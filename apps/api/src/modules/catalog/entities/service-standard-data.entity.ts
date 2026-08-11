import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// بيانات قياسية للخدمة + محرك الإنتاجية (docs/06 §3.1-§3.6) — مطابق لـ infra/migrations/0054.
@Entity('service_standard_data')
export class ServiceStandardData {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'service_id', type: 'uuid' })
  serviceId: string;

  @Column({ name: 'execution_type_ar', type: 'varchar', length: 80, default: 'عام' })
  executionTypeAr: string;

  @Column({ name: 'unit_ar', type: 'varchar', length: 20 })
  unitAr: string;

  @Column({ name: 'technician_daily_wage_cents', type: 'integer' })
  technicianDailyWageCents: number;

  @Column({ name: 'assistant_daily_wage_cents', type: 'integer', nullable: true })
  assistantDailyWageCents: number | null;

  @Column({ name: 'productivity_per_day', type: 'numeric', precision: 10, scale: 2 })
  productivityPerDay: string;

  @Column({ name: 'min_technicians', type: 'smallint', default: 1 })
  minTechnicians: number;

  @Column({ name: 'min_assistants', type: 'smallint', default: 0 })
  minAssistants: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'display_order', type: 'smallint', default: 0 })
  displayOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
