import { Column, Entity, PrimaryColumn } from 'typeorm';

export enum PayoutMethod {
  BANK_TRANSFER = 'bank_transfer',
  VODAFONE_CASH = 'vodafone_cash',
  INSTAPAY = 'instapay',
  CASH = 'cash',
}

export enum PayoutStatus {
  REQUESTED = 'requested',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  REJECTED = 'rejected',
  FAILED = 'failed',
}

@Entity('payouts')
export class Payout {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'payout_number', type: 'varchar', length: 24, unique: true })
  payoutNumber: string;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @Column({ name: 'wallet_id', type: 'uuid' })
  walletId: string;

  @Column({ name: 'amount_cents', type: 'integer' })
  amountCents: number;

  @Column({ name: 'fee_cents', type: 'integer', default: 0 })
  feeCents: number;

  @Column({ name: 'net_amount_cents', type: 'integer' })
  netAmountCents: number;

  @Column({ name: 'payout_method', type: 'enum', enum: PayoutMethod, enumName: 'payout_method' })
  payoutMethod: PayoutMethod;

  @Column({ name: 'destination_masked', type: 'varchar', length: 40, nullable: true })
  destinationMasked: string | null;

  @Column({ name: 'payout_status', type: 'enum', enum: PayoutStatus, enumName: 'payout_status', default: PayoutStatus.REQUESTED })
  payoutStatus: PayoutStatus;

  @Column({ name: 'requested_at', type: 'timestamptz' })
  requestedAt: Date;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true })
  reviewedByUserId: string | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;
}
