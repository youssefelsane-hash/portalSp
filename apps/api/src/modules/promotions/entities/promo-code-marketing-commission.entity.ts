import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export const PROMO_MARKETING_COMMISSION_STATUSES = ['accrued', 'paid', 'cancelled'] as const;
export type PromoMarketingCommissionStatus = (typeof PROMO_MARKETING_COMMISSION_STATUSES)[number];

/** مستحق خارجي لمصدر الكود، منفصل تمامًا عن خصم العميل ومستحقات طاقم التنفيذ. */
@Entity('promo_code_marketing_commissions')
export class PromoCodeMarketingCommission {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'promo_code_id', type: 'uuid' })
  promoCodeId: string;

  @Column({ name: 'order_id', type: 'uuid', unique: true })
  orderId: string;

  @Column({ name: 'customer_user_id', type: 'uuid' })
  customerUserId: string;

  @Column({ name: 'amount_cents', type: 'integer' })
  amountCents: number;

  @Column({ type: 'varchar', length: 20, default: 'accrued' })
  status: PromoMarketingCommissionStatus;

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
}
