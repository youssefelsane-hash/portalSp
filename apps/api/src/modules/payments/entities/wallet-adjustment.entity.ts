import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export type WalletAdjustmentDirection = 'credit' | 'debit';

@Entity('wallet_adjustments')
@Index(['actorUserId', 'idempotencyKey'], { unique: true })
export class WalletAdjustment {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'actor_user_id', type: 'uuid' })
  actorUserId: string;

  @Column({ name: 'target_user_id', type: 'uuid' })
  targetUserId: string;

  @Column({ name: 'target_wallet_id', type: 'uuid' })
  targetWalletId: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 120 })
  idempotencyKey: string;

  @Column({ name: 'amount_cents', type: 'integer' })
  amountCents: number;

  @Column({ type: 'varchar', length: 10 })
  direction: WalletAdjustmentDirection;

  @Column({ name: 'reason_ar', type: 'text' })
  reasonAr: string;

  @Column({ name: 'wallet_debit_tx_id', type: 'uuid', nullable: true })
  walletDebitTxId: string | null;

  @Column({ name: 'wallet_credit_tx_id', type: 'uuid', nullable: true })
  walletCreditTxId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
