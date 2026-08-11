import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// سجل كل عملية حساب فعلية — للتدقيق/المراجعة بس، مش للعرض المباشر (docs/08 §1.3).
@Entity('service_pricing_evaluations')
export class ServicePricingEvaluation {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'service_id', type: 'uuid' })
  serviceId: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ name: 'field_values', type: 'jsonb' })
  fieldValues: Record<string, unknown>;

  @Column({ name: 'computed_price_cents', type: 'integer' })
  computedPriceCents: number;

  @Column({ name: 'computed_duration_days', type: 'numeric', precision: 6, scale: 2, nullable: true })
  computedDurationDays: string | null;

  @Column({ name: 'computed_technicians', type: 'smallint', nullable: true })
  computedTechnicians: number | null;

  @Column({ name: 'computed_assistants', type: 'smallint', nullable: true })
  computedAssistants: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
