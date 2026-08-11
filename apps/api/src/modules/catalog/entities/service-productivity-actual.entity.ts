import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// أساس محرك الإنتاجية الذاتي التعلّم (docs/06 §3.9) — مرحلة 1: تسجيل بيانات فعلية بس، مش
// خوارزمية التحديث التلقائي (مرحلة لاحقة، محتاجة بيانات تاريخية ضخمة). مطابق لـ
// infra/migrations/0057.
@Entity('service_productivity_actuals')
export class ServiceProductivityActual {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'service_standard_data_id', type: 'uuid' })
  serviceStandardDataId: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ name: 'actual_units', type: 'numeric', precision: 10, scale: 2 })
  actualUnits: string;

  @Column({ name: 'actual_days', type: 'numeric', precision: 6, scale: 2 })
  actualDays: string;

  @Column({ name: 'actual_technicians', type: 'smallint' })
  actualTechnicians: number;

  @Column({ name: 'actual_assistants', type: 'smallint' })
  actualAssistants: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'recorded_by_user_id', type: 'uuid', nullable: true })
  recordedByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
