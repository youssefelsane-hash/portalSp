import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum WalletOwnerType {
  CUSTOMER = 'customer',
  TECHNICIAN = 'technician',
  PARTNER = 'partner',
  PLATFORM = 'platform',
  // قطاع الخدمات المنزلية (docs/08 §12، ADR-0004) — شغالة/مربية/مقيمة، تصنيف مستقل عن technician.
  DOMESTIC_WORKER = 'domestic_worker',
}

// حساب المنصة الثابت — infra/migrations/0019_platform_system_account.sql
export const PLATFORM_SYSTEM_USER_ID = '00000000-0000-7000-8000-000000000001';

@Entity('wallets')
export class Wallet {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'owner_user_id', type: 'uuid', unique: true })
  ownerUserId: string;

  @Column({ name: 'owner_type', type: 'enum', enum: WalletOwnerType, enumName: 'wallet_owner_type' })
  ownerType: WalletOwnerType;

  @Column({ name: 'balance_cents', type: 'integer', default: 0 })
  balanceCents: number;

  @Column({ name: 'pending_balance_cents', type: 'integer', default: 0 })
  pendingBalanceCents: number;

  @Column({ name: 'reserved_balance_cents', type: 'integer', default: 0 })
  reservedBalanceCents: number;

  @Column({ name: 'total_earned_cents', type: 'integer', default: 0 })
  totalEarnedCents: number;

  @Column({ name: 'total_withdrawn_cents', type: 'integer', default: 0 })
  totalWithdrawnCents: number;

  @Column({ name: 'currency_code', type: 'varchar', length: 3, default: 'EGP' })
  currencyCode: string;

  @Column({ name: 'is_frozen', type: 'boolean', default: false })
  isFrozen: boolean;

  @Column({ name: 'frozen_reason', type: 'text', nullable: true })
  frozenReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
