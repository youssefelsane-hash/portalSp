import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type DebtSettlementMethod = 'cash' | 'instapay' | 'bank_transfer';

// مطابق بالحرف لـ infra/migrations/0196_technician_debt_settlements.sql
@Entity('technician_debt_settlements')
export class TechnicianDebtSettlement {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @Column({ name: 'amount_cents', type: 'integer' })
  amountCents: number;

  @Column({ name: 'method', type: 'varchar', length: 20 })
  method: DebtSettlementMethod;

  @Column({ name: 'external_reference', type: 'varchar', length: 120, nullable: true })
  externalReference: string | null;

  @Column({ name: 'note', type: 'varchar', length: 500, nullable: true })
  note: string | null;

  // snapshot الرصيد قبل/بعد — الصف يفضل مفهوم لوحده بعد سنين بلا إعادة حساب.
  @Column({ name: 'balance_before_cents', type: 'integer' })
  balanceBeforeCents: number;

  @Column({ name: 'balance_after_cents', type: 'integer' })
  balanceAfterCents: number;

  @Column({ name: 'recorded_by_user_id', type: 'uuid' })
  recordedByUserId: string;

  @Column({ name: 'wallet_transaction_id', type: 'uuid', nullable: true })
  walletTransactionId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
