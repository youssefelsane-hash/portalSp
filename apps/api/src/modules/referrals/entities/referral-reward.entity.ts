import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('referral_rewards')
@Index(['referrerUserId', 'milestoneCount'], { unique: true })
export class ReferralReward {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'referrer_user_id', type: 'uuid' })
  referrerUserId: string;

  @Column({ name: 'milestone_count', type: 'integer' })
  milestoneCount: number;

  @Column({ name: 'promo_code_id', type: 'uuid', unique: true })
  promoCodeId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
