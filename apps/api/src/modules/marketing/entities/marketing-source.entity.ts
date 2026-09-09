import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * قناة المصدر — **وصف على الصف مش جدول** (ADR-0082 §1).
 *
 * القنوات بتتغيّر مع الوقت (النهارده بوستر وإنفلونسر، بكرة تيك توك ومعارض). لو كل قناة جدول
 * أو موديول، أي قناة جديدة بتحتاج migration وكود. هنا قناة جديدة = قيمة جديدة في القايمة دي.
 */
export const MARKETING_CHANNELS = [
  'poster',
  'influencer',
  'facebook',
  'whatsapp',
  'doorman',
  'referral',
  'partner',
  'other',
] as const;
export type MarketingChannel = (typeof MARKETING_CHANNELS)[number];

// مطابق لـ infra/migrations/0307_marketing_attribution.sql
@Entity('marketing_sources')
export class MarketingSource {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ type: 'varchar', length: 24 })
  code: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 120 })
  nameAr: string;

  @Index()
  @Column({ type: 'varchar', length: 30 })
  channel: MarketingChannel;

  /** نص حر مش FK: الحملة ممكن تكون على منطقة مش متعرّفة عندنا كنطاق خدمة («سموحة»). */
  @Column({ name: 'region_label', type: 'varchar', length: 120, nullable: true })
  regionLabel: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** صفر = مصدر تتبّع بس بلا أي مستحقات. */
  @Column({ name: 'payout_per_completed_order_cents', type: 'int', default: 0 })
  payoutPerCompletedOrderCents: number;

  @Column({ name: 'payout_contact_name', type: 'varchar', length: 120, nullable: true })
  payoutContactName: string | null;

  @Column({ name: 'payout_contact_phone', type: 'varchar', length: 20, nullable: true })
  payoutContactPhone: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
