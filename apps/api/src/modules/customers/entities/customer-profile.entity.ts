import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum CustomerTier {
  STANDARD = 'standard',
  SILVER = 'silver',
  GOLD = 'gold',
  VIP = 'vip',
}

@Entity('customer_profiles')
export class CustomerProfile {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @Column({ name: 'default_address_id', type: 'uuid', nullable: true })
  defaultAddressId: string | null;

  @Column({ name: 'total_orders_count', type: 'integer', default: 0 })
  totalOrdersCount: number;

  @Column({ name: 'completed_orders_count', type: 'integer', default: 0 })
  completedOrdersCount: number;

  @Column({ name: 'cancelled_orders_count', type: 'integer', default: 0 })
  cancelledOrdersCount: number;

  @Column({ name: 'total_spent_cents', type: 'integer', default: 0 })
  totalSpentCents: number;

  @Column({ name: 'loyalty_points_balance', type: 'integer', default: 0 })
  loyaltyPointsBalance: number;

  @Column({ name: 'customer_tier', type: 'enum', enum: CustomerTier, enumName: 'customer_tier', default: CustomerTier.STANDARD })
  customerTier: CustomerTier;

  @Column({ name: 'average_rating_given', type: 'numeric', precision: 3, scale: 2, nullable: true })
  averageRatingGiven: string | null;

  @Column({ name: 'is_high_risk', type: 'boolean', default: false })
  isHighRisk: boolean;

  @Column({ name: 'first_order_at', type: 'timestamptz', nullable: true })
  firstOrderAt: Date | null;

  @Column({ name: 'last_order_at', type: 'timestamptz', nullable: true })
  lastOrderAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
