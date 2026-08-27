import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export const INTENT_STAGES = ['viewed_service', 'started_booking'] as const;
export type IntentStage = (typeof INTENT_STAGES)[number];

/**
 * «العميل بص على خدمة/بدأ حجز وما كمّلش» (ADR-0046 §5) — إشارة **صريحة** من التطبيق، مش
 * استنتاج من الطلبات الملغية (دي حالة تانية خالص: حجز فعلاً وبعدين لغى).
 *
 * الصفوف دي عابرة بطبيعتها وبتتنضّف تلقائيًا في نفس الـsweep — إشارة تسويقية، مش سجل دائم
 * لسلوك العميل.
 */
@Entity('customer_service_intents')
export class CustomerServiceIntent {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'service_id', type: 'uuid' })
  serviceId: string;

  @Column({ name: 'intent_stage', type: 'varchar', length: 30, default: 'viewed_service' })
  intentStage: IntentStage;

  @Column({ name: 'occurred_at', type: 'timestamptz', default: () => 'now()' })
  occurredAt: Date;

  /** اتعامل معاه المحرك (اتبعت أو اتجاهل)؟ بيمنع إعادة معالجة نفس الاهتمام. */
  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
