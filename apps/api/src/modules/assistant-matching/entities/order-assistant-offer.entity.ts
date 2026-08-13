import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum AssistantOfferStatus {
  SENT = 'sent',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
  // اتقفلت لأن مساعد تاني كسب السباق على نفس الشريحة قبل ما ده يرد — مختلفة عمداً عن EXPIRED
  // (محدش رد قبل المهلة).
  SLOT_FILLED = 'slot_filled',
}

// مطابق لـ infra/migrations/0070_assistant_pool_matching.sql (ADR-0007) — بث/عرض فردي لكل
// مرشّح مساعد، نفس فلسفة order_assignments بس لمجال "شرائح مساعد" (ممكن أكتر من صف accepted
// لنفس الطلب لو orders.required_assistants > 1).
@Entity('order_assistant_offers')
export class OrderAssistantOffer {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'assistant_technician_id', type: 'uuid' })
  assistantTechnicianId: string;

  @Column({
    name: 'offer_status',
    type: 'varchar',
    length: 20,
    default: AssistantOfferStatus.SENT,
  })
  offerStatus: AssistantOfferStatus;

  @Column({ name: 'sent_at', type: 'timestamptz' })
  sentAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
