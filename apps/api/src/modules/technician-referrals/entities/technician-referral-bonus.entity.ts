import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum TechnicianReferralBonusStatus {
  CREDITED = 'credited',
  REVOKED = 'revoked',
  REJECTED_SUSPICIOUS = 'rejected_suspicious',
  MANUAL_REVIEW = 'manual_review',
}

// مطابق لـ infra/migrations/0082_technician_qr_referral.sql
@Entity('technician_referral_bonuses')
export class TechnicianReferralBonus {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @Column({ name: 'customer_user_id', type: 'uuid' })
  customerUserId: string;

  @Column({ name: 'order_id', type: 'uuid', unique: true })
  orderId: string;

  @Column({ name: 'bonus_amount_cents', type: 'integer' })
  bonusAmountCents: number;

  @Column({
    type: 'varchar',
    length: 20,
    default: TechnicianReferralBonusStatus.CREDITED,
  })
  status: TechnicianReferralBonusStatus;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  // لقطة وقت التقييم، مش استعلام حي — راجع تعليق migration 0082 لسبب اللقطة بدل الاستعلام الحي.
  @Column({ name: 'customer_device_id', type: 'varchar', length: 128, nullable: true })
  customerDeviceId: string | null;

  @Column({ name: 'credited_at', type: 'timestamptz', nullable: true })
  creditedAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'revoked_reason', type: 'text', nullable: true })
  revokedReason: string | null;

  @Column({ name: 'wallet_debit_tx_id', type: 'uuid', nullable: true })
  walletDebitTxId: string | null;

  @Column({ name: 'wallet_credit_tx_id', type: 'uuid', nullable: true })
  walletCreditTxId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
