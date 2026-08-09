import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق لـ infra/migrations/0049_referrals.sql
export enum ReferralStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
}

@Entity('referrals')
export class Referral {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'referrer_user_id', type: 'uuid' })
  referrerUserId: string;

  @Index({ unique: true })
  @Column({ name: 'referred_user_id', type: 'uuid' })
  referredUserId: string;

  @Column({ type: 'enum', enum: ReferralStatus, enumName: 'referral_status', default: ReferralStatus.PENDING })
  status: ReferralStatus;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'reference_order_id', type: 'uuid', nullable: true })
  referenceOrderId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
