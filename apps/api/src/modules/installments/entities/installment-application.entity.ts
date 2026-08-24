import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { InstallmentApplicationStatus } from './installment-status.enum';

// طلب تقسيط — الـsnapshot المالي كله authoritative محسوب وقت التقديم من الخطة + سعر الطلب
// (computeInstallmentBreakdown) ومخزّن هنا **غير قابل للتعديل**: تغيير الخطة بعدين بيطبق
// prospectively على الطلبات الجديدة بس، وتاريخ الشروط يفضل ثابت (متطلب شفافية مالية).
@Entity('installment_applications')
export class InstallmentApplication {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @Column({ type: 'varchar', length: 20, default: InstallmentApplicationStatus.PENDING_REVIEW })
  status: InstallmentApplicationStatus;

  // ===== Snapshot مالي (قرش integer — راجع installment-calculator.ts) =====
  @Column({ name: 'service_price_cents', type: 'integer' })
  servicePriceCents: number;

  @Column({ name: 'financing_percentage', type: 'numeric', precision: 5, scale: 2 })
  financingPercentage: string;

  @Column({ name: 'fixed_fee_cents', type: 'integer' })
  fixedFeeCents: number;

  @Column({ name: 'financing_fee_cents', type: 'integer' })
  financingFeeCents: number;

  @Column({ name: 'total_financed_cents', type: 'integer' })
  totalFinancedCents: number;

  @Column({ name: 'down_payment_percentage', type: 'numeric', precision: 5, scale: 2 })
  downPaymentPercentage: string;

  @Column({ name: 'down_payment_cents', type: 'integer' })
  downPaymentCents: number;

  @Column({ name: 'financed_balance_cents', type: 'integer' })
  financedBalanceCents: number;

  @Column({ name: 'installment_count', type: 'integer' })
  installmentCount: number;

  @Column({ name: 'regular_installment_cents', type: 'integer' })
  regularInstallmentCents: number;

  /** القسط الأخير بيستوعب فرق التقريب — sum(regular×(N-1) + final) + مقدم = الإجمالي. */
  @Column({ name: 'final_installment_cents', type: 'integer' })
  finalInstallmentCents: number;

  @Column({ name: 'interval_days', type: 'integer' })
  intervalDays: number;

  @Column({ name: 'first_due_at', type: 'timestamptz' })
  firstDueAt: Date;

  // وسيلة الدفع المحفوظة (tokenized) المختارة للتحصيل التلقائي — مرجع provider فقط.
  @Column({ name: 'payment_method_id', type: 'uuid', nullable: true })
  paymentMethodId: string | null;

  @Column({ name: 'allowed_provider', type: 'varchar', length: 40, default: 'paymob' })
  allowedProvider: string;

  /** إثبات قبول الشروط: payment_policy_versions.id اللي العميل قبلها فعلاً وقت التقديم. */
  @Column({ name: 'accepted_policy_version_id', type: 'uuid', nullable: true })
  acceptedPolicyVersionId: string | null;

  // ===== المراجعة البشرية =====
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'review_notes', type: 'text', nullable: true })
  reviewNotes: string | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', default: () => 'now()' })
  submittedAt: Date;

  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
