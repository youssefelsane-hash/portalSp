import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export enum WalletTxDirection {
  CREDIT = 'credit',
  DEBIT = 'debit',
}

export enum WalletTxType {
  ORDER_EARNING = 'order_earning',
  COMMISSION_DEDUCTION = 'commission_deduction',
  TOPUP = 'topup',
  WITHDRAWAL = 'withdrawal',
  REFUND = 'refund',
  PENALTY = 'penalty',
  BONUS = 'bonus',
  REFERRAL_REWARD = 'referral_reward',
  ADJUSTMENT = 'adjustment',
}

// قيد مزدوج — ممنوع أي UPDATE أو DELETE (مفروض على مستوى الداتابيز في 0008_finance.sql).
// الغلط يتصحّح بقيد عكسي جديد بس، مش بتعديل القديم.
@Entity('wallet_transactions')
export class WalletTransaction {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'wallet_id', type: 'uuid' })
  walletId: string;

  @Column({ name: 'transaction_number', type: 'varchar', length: 24, unique: true })
  transactionNumber: string;

  @Column({ type: 'enum', enum: WalletTxDirection, enumName: 'wallet_tx_direction' })
  direction: WalletTxDirection;

  @Column({ name: 'transaction_type', type: 'enum', enum: WalletTxType, enumName: 'wallet_tx_type' })
  transactionType: WalletTxType;

  @Column({ name: 'amount_cents', type: 'integer' })
  amountCents: number;

  @Column({ name: 'balance_before_cents', type: 'integer' })
  balanceBeforeCents: number;

  @Column({ name: 'balance_after_cents', type: 'integer' })
  balanceAfterCents: number;

  @Column({ name: 'reference_type', type: 'varchar', length: 40, nullable: true })
  referenceType: string | null;

  @Column({ name: 'reference_id', type: 'uuid', nullable: true })
  referenceId: string | null;

  @Column({ name: 'description_ar', type: 'varchar', length: 255, nullable: true })
  descriptionAr: string | null;

  @Column({ name: 'performed_by_user_id', type: 'uuid', nullable: true })
  performedByUserId: string | null;

  @Column({ name: 'is_reversed', type: 'boolean', default: false })
  isReversed: boolean;

  @Column({ name: 'reversal_transaction_id', type: 'uuid', nullable: true })
  reversalTransactionId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
