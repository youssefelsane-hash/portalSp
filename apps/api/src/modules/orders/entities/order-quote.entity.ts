import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum OrderQuoteSource {
  ADMIN_REMOTE = 'admin_remote',
  TECHNICIAN_ONSITE = 'technician_onsite',
  TECHNICIAN_DIAGNOSIS = 'technician_diagnosis',
}

export enum OrderQuoteStatus {
  PENDING_ADMIN_REVIEW = 'pending_admin_review',
  PENDING_CUSTOMER = 'pending_customer',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
  SUPERSEDED = 'superseded',
}

@Entity('order_quotes')
export class OrderQuote {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ type: 'integer' })
  version: number;

  @Column({ type: 'varchar', length: 30 })
  source: OrderQuoteSource;

  @Column({ type: 'varchar', length: 30 })
  status: OrderQuoteStatus;

  @Column({ name: 'amount_cents', type: 'integer' })
  amountCents: number;

  @Column({ type: 'text', nullable: true })
  diagnosis: string | null;

  @Column({ name: 'scope_included', type: 'text', nullable: true })
  scopeIncluded: string | null;

  @Column({ name: 'scope_excluded', type: 'text', nullable: true })
  scopeExcluded: string | null;

  @Column({ name: 'estimated_duration_minutes', type: 'integer', nullable: true })
  estimatedDurationMinutes: number | null;

  @Column({ name: 'required_technicians', type: 'smallint', nullable: true })
  requiredTechnicians: number | null;

  @Column({ name: 'required_assistants', type: 'smallint', nullable: true })
  requiredAssistants: number | null;

  @Column({ name: 'expected_min_cents', type: 'integer', nullable: true })
  expectedMinCents: number | null;

  @Column({ name: 'expected_max_cents', type: 'integer', nullable: true })
  expectedMaxCents: number | null;

  @Column({ name: 'revision_reason', type: 'text', nullable: true })
  revisionReason: string | null;

  @Column({ name: 'submitted_by_user_id', type: 'uuid' })
  submittedByUserId: string;

  @Column({ name: 'admin_decided_by_user_id', type: 'uuid', nullable: true })
  adminDecidedByUserId: string | null;

  @Column({ name: 'admin_decided_at', type: 'timestamptz', nullable: true })
  adminDecidedAt: Date | null;

  @Column({ name: 'customer_decided_by_user_id', type: 'uuid', nullable: true })
  customerDecidedByUserId: string | null;

  @Column({ name: 'customer_decided_at', type: 'timestamptz', nullable: true })
  customerDecidedAt: Date | null;

  @Column({ name: 'valid_until', type: 'timestamptz' })
  validUntil: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

