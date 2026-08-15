import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum DomesticWorkerEarningApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

// طابور موافقة أرباح العمالة المنزلية (docs/08 §25.1، قرار مالك صريح 2026-08-15) — مطابق لـ
// infra/migrations/0112_domestic_worker_earning_approvals.sql. أرباح الشغالة/العامل بتدخل هنا
// "pending" بدل ما تروح مباشرة لـ Wallet.balanceCents — مفيش أي مسار غير هذا الطابور يقدر يحوّلها
// رصيد قابل للصرف (راجع DomesticWorkerEarningApprovalsService.approve()).
@Entity('domestic_worker_earning_approvals')
export class DomesticWorkerEarningApproval {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  @Column({ name: 'worker_user_id', type: 'uuid' })
  workerUserId: string;

  @Column({ name: 'amount_cents', type: 'integer' })
  amountCents: number;

  @Column({
    type: 'enum',
    enum: DomesticWorkerEarningApprovalStatus,
    enumName: 'domestic_worker_earning_approval_status',
    default: DomesticWorkerEarningApprovalStatus.PENDING,
  })
  status: DomesticWorkerEarningApprovalStatus;

  @Column({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true })
  reviewedByUserId: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
