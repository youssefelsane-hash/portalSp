import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export const MARKETING_COMMISSION_STATUSES = ['accrued', 'paid', 'cancelled'] as const;
export type MarketingCommissionStatus = (typeof MARKETING_COMMISSION_STATUSES)[number];

/**
 * مستحق لمصدر تسويق عن شغلانة اتمّت (عمولة البواب — ADR-0082 §5).
 *
 * **مش قيد محفظة**: الصف ده بيقول للأدمن «المصدر ده مستحقّله كذا»، والصرف بيتم بمسار الصرف
 * الموجود. القيد التلقائي محتاج البواب يبقى عنده حساب ومحفظة، وشبكة البوابين بتتدفع كاش عمليًا.
 *
 * `UNIQUE(order_id)` في القاعدة هو حارس الـidempotency: حدث اكتمال الطلب ممكن يتكرر (إعادة
 * تشغيل، نسختين شغّالين، sweep استرداد) والتكرار مايولّدش مستحق تاني على نفس الشغلانة.
 */
// مطابق لـ infra/migrations/0307_marketing_attribution.sql
@Entity('marketing_source_commissions')
export class MarketingSourceCommission {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'source_id', type: 'uuid' })
  sourceId: string;

  @Column({ name: 'order_id', type: 'uuid', unique: true })
  orderId: string;

  @Column({ name: 'customer_user_id', type: 'uuid' })
  customerUserId: string;

  @Column({ name: 'amount_cents', type: 'int' })
  amountCents: number;

  @Column({ type: 'varchar', length: 20, default: 'accrued' })
  status: MarketingCommissionStatus;

  @Column({ name: 'accrued_at', type: 'timestamptz', default: () => 'now()' })
  accruedAt: Date;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'paid_by_user_id', type: 'uuid', nullable: true })
  paidByUserId: string | null;

  @Column({ name: 'payment_note', type: 'text', nullable: true })
  paymentNote: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
