import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('promo_code_usages')
export class PromoCodeUsage {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'promo_code_id', type: 'uuid' })
  promoCodeId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'discount_applied_cents', type: 'integer' })
  discountAppliedCents: number;

  @CreateDateColumn({ name: 'used_at', type: 'timestamptz' })
  usedAt: Date;
}
