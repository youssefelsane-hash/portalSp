import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * أنواع الحملات (ADR-0046 §4). قيمة نصّية مش enum قاعدة عمدًا — إضافة نوع تالت بعدين ما
 * تحتاجش migration على enum ولا نشر متزامن للـAPI والقاعدة.
 */
export const CAMPAIGN_TYPES = ['periodic_promo', 'abandoned_intent'] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

@Entity('notification_campaigns')
export class NotificationCampaign {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'campaign_type', type: 'varchar', length: 40 })
  campaignType: CampaignType;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** قالب فيه متغيّرات `{{service_name}}` — بيتملى ببيانات حقيقية وقت الإرسال. */
  @Column({ name: 'title_template_ar', type: 'varchar', length: 160 })
  titleTemplateAr: string;

  @Column({ name: 'body_template_ar', type: 'text' })
  bodyTemplateAr: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** أقل عدد أيام بين إرسالين من **نفس** الحملة لنفس العميل. */
  @Column({ name: 'cooldown_days', type: 'smallint', default: 4 })
  cooldownDays: number;

  /** الأعلى بيتختار الأول لما أكتر من حملة مؤهلة في نفس اللحظة. */
  @Column({ type: 'smallint', default: 100 })
  priority: number;

  /** لـ`abandoned_intent` بس: بعد كام دقيقة من الاهتمام المتروك نبعت. NULL = استخدم الإعداد العام. */
  @Column({ name: 'trigger_delay_minutes', type: 'int', nullable: true })
  triggerDelayMinutes: number | null;

  /** تقييد اختياري على فئة — NULL = كل الفئات. */
  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
