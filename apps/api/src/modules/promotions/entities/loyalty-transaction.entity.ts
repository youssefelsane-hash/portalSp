import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export enum LoyaltyDirection {
  EARN = 'earn',
  REDEEM = 'redeem',
  EXPIRE = 'expire',
}

export enum LoyaltySource {
  ORDER = 'order',
  REFERRAL = 'referral',
  REVIEW = 'review',
  PROMOTION = 'promotion',
  MANUAL = 'manual',
}

@Entity('loyalty_transactions')
export class LoyaltyTransaction {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'points_amount', type: 'integer' })
  pointsAmount: number;

  @Column({ type: 'enum', enum: LoyaltyDirection, enumName: 'loyalty_direction' })
  direction: LoyaltyDirection;

  @Column({ type: 'enum', enum: LoyaltySource, enumName: 'loyalty_source' })
  source: LoyaltySource;

  @Column({ name: 'reference_id', type: 'uuid', nullable: true })
  referenceId: string | null;

  @Column({ name: 'balance_after', type: 'integer' })
  balanceAfter: number;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  /**
   * علامة إن الـsweep فحص الدفعة دي وحسم اللي فضل فيها (تدقيق L-6). بتتحط حتى لو الدفعة كانت
   * مستهلكة بالكامل — من غير كده الـsweep هيفضل يعيد فحص نفس الصفوف كل يوم للأبد.
   */
  @Column({ name: 'expired_at', type: 'timestamptz', nullable: true })
  expiredAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
