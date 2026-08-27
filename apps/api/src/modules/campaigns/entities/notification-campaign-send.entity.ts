import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * سجل إرسال دائم (ADR-0046 §7). **مش لوج** — ده مصدر الحقيقة اللي بيتبني عليه سقف التكرار
 * والـcooldown، **وكمان** اللي الأدمن بيشوف منه أداء كل حملة. حاجة واحدة بتخدم غرضين، فمفيش
 * عدّاد موازي ممكن يفرق عن الواقع.
 */
@Entity('notification_campaign_sends')
export class NotificationCampaignSend {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'campaign_id', type: 'uuid' })
  campaignId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** الخدمة اللي اتعلن عنها فعليًا — بيخلّي سؤال "أنهي خدمة بتجيب طلبات؟" قابل للإجابة. */
  @Column({ name: 'service_id', type: 'uuid', nullable: true })
  serviceId: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', default: () => 'now()' })
  sentAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
