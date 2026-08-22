import { Column, Entity, PrimaryColumn } from 'typeorm';

export enum RefundType {
  FULL = 'full',
  PARTIAL = 'partial',
}

export enum RefundMethod {
  ORIGINAL_METHOD = 'original_method',
  WALLET_CREDIT = 'wallet_credit',
  CASH = 'cash',
}

export enum RefundStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  REJECTED = 'rejected',
}

@Entity('refunds')
export class Refund {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'refund_number', type: 'varchar', length: 24, unique: true })
  refundNumber: string;

  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId: string;

  // كان ممكن يبقى NULL لو الاسترداد لحجز خدمة منزلية (بنية منفصلة اتلغت، ADR-0031) — العمود لسه
  // nullable في الـDB، بس دايمًا موجود عمليًا الآن.
  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ name: 'amount_cents', type: 'integer' })
  amountCents: number;

  @Column({ name: 'refund_type', type: 'enum', enum: RefundType, enumName: 'refund_type' })
  refundType: RefundType;

  @Column({ name: 'reason_notes', type: 'text', nullable: true })
  reasonNotes: string | null;

  @Column({ name: 'refund_method', type: 'enum', enum: RefundMethod, enumName: 'refund_method' })
  refundMethod: RefundMethod;

  @Column({ name: 'refund_status', type: 'enum', enum: RefundStatus, enumName: 'refund_status', default: RefundStatus.PENDING })
  refundStatus: RefundStatus;

  @Column({ name: 'requested_by_user_id', type: 'uuid' })
  requestedByUserId: string;

  @Column({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  approvedByUserId: string | null;

  @Column({ name: 'requested_at', type: 'timestamptz' })
  requestedAt: Date;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  // مرجع استرداد البوابة الحقيقي (مثلاً id استرداد Paymob) — null لو الاسترداد اتعمل عبر رصيد
  // محفظة بس (مفيش بوابة اتحاول أصلاً، ADR-0013 §9). مضافة في migration 0093.
  @Column({ name: 'provider_refund_id', type: 'varchar', length: 120, nullable: true })
  providerRefundId: string | null;
}
