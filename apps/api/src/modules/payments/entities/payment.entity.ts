import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export enum PaymentMethod {
  CASH = 'cash',
  CARD = 'card',
  WALLET = 'wallet',
  BANK_TRANSFER = 'bank_transfer',
  CORPORATE_CREDIT = 'corporate_credit',
}

export enum PaymentGatewayStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  REFUNDED = 'refunded',
}

@Entity('payments')
export class Payment {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'payment_number', type: 'varchar', length: 24, unique: true })
  paymentNumber: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'amount_cents', type: 'integer' })
  amountCents: number;

  @Column({ name: 'currency_code', type: 'varchar', length: 3, default: 'EGP' })
  currencyCode: string;

  @Column({ name: 'payment_method', type: 'enum', enum: PaymentMethod, enumName: 'payment_method' })
  paymentMethod: PaymentMethod;

  @Column({ name: 'payment_gateway', type: 'varchar', length: 40, nullable: true })
  paymentGateway: string | null;

  @Column({ name: 'gateway_transaction_id', type: 'varchar', length: 120, nullable: true })
  gatewayTransactionId: string | null;

  @Column({ name: 'gateway_response', type: 'jsonb', nullable: true })
  gatewayResponse: Record<string, unknown> | null;

  @Column({
    name: 'payment_status',
    type: 'enum',
    enum: PaymentGatewayStatus,
    enumName: 'payment_gateway_status',
    default: PaymentGatewayStatus.PENDING,
  })
  paymentStatus: PaymentGatewayStatus;

  @Column({ name: 'failure_code', type: 'varchar', length: 60, nullable: true })
  failureCode: string | null;

  @Column({ name: 'failure_message', type: 'text', nullable: true })
  failureMessage: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 80, unique: true })
  idempotencyKey: string;

  @CreateDateColumn({ name: 'initiated_at', type: 'timestamptz' })
  initiatedAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt: Date | null;

  @Column({ name: 'collected_by_user_id', type: 'uuid', nullable: true })
  collectedByUserId: string | null;
}
