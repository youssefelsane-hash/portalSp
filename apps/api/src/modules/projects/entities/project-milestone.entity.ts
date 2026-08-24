import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('project_milestones')
export class ProjectMilestone {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ name: 'sequence_number', type: 'integer' })
  sequenceNumber: number;

  @Column({ name: 'name_ar', type: 'varchar', length: 200 })
  nameAr: string;
  @Column({ name: 'description_ar', type: 'text', nullable: true })
  descriptionAr: string | null;
  @Column({ name: 'amount_cents', type: 'integer' })
  amountCents: number;
  @Column({ name: 'is_down_payment', type: 'boolean', default: false })
  isDownPayment: boolean;
  @Column({ name: 'expected_date', type: 'date', nullable: true })
  expectedDate: string | null;
  @Column({ name: 'completion_criteria', type: 'text', nullable: true })
  completionCriteria: string | null;

  @Column({ name: 'execution_status', type: 'varchar', length: 20, default: 'pending' })
  executionStatus: string; // pending | in_progress | completed | rejected
  @Column({ name: 'approval_status', type: 'varchar', length: 20, default: 'pending' })
  approvalStatus: string; // pending | approved | rejected
  @Column({ name: 'payment_status', type: 'varchar', length: 20, default: 'unpaid' })
  paymentStatus: string; // unpaid | pending_payment | paid
  @Column({ name: 'payout_status', type: 'varchar', length: 20, default: 'held' })
  payoutStatus: string; // held | released

  @Column({ name: 'proof_attachments', type: 'jsonb', default: '[]' })
  proofAttachments: { storage_key: string; uploaded_at: string }[];
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;
  @Column({ name: 'approved_by_customer', type: 'boolean', nullable: true })
  approvedByCustomer: boolean | null;
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;
  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;
  @Column({ name: 'payout_released_at', type: 'timestamptz', nullable: true })
  payoutReleasedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('warranty_plans')
export class WarrantyPlan {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ type: 'varchar', length: 60, unique: true })
  slug: string;
  @Column({ name: 'name_ar', type: 'varchar', length: 200 })
  nameAr: string;
  @Column({ name: 'warranty_type', type: 'varchar', length: 40, default: 'extended_workmanship' })
  warrantyType: string; // workmanship | extended_workmanship

  @Column({ name: 'target_service_id', type: 'uuid', nullable: true })
  targetServiceId: string | null;
  @Column({ name: 'target_category_id', type: 'uuid', nullable: true })
  targetCategoryId: string | null;
  @Column({ name: 'target_project_type', type: 'varchar', length: 30, nullable: true })
  targetProjectType: string | null;

  @Column({ name: 'pricing_model', type: 'varchar', length: 20, default: 'fixed' })
  pricingModel: string; // fixed | percentage
  @Column({ name: 'price_value', type: 'numeric', precision: 10, scale: 2, default: 0 })
  priceValue: string;

  @Column({ name: 'coverage_months', type: 'integer' })
  coverageMonths: number;
  @Column({ name: 'max_coverage_cents', type: 'integer', nullable: true })
  maxCoverageCents: number | null;
  @Column({ name: 'max_claims', type: 'integer', default: 1 })
  maxClaims: number;
  @Column({ name: 'terms_ar', type: 'text', nullable: true })
  termsAr: string | null;
  @Column({ name: 'exclusions_ar', type: 'text', nullable: true })
  exclusionsAr: string | null;
  @Column({ name: 'sla_ack_hours', type: 'integer', default: 48 })
  slaAckHours: number;
  @Column({ name: 'sla_inspection_hours', type: 'integer', default: 72 })
  slaInspectionHours: number;
  @Column({ name: 'sla_repair_start_hrs', type: 'integer', default: 168 })
  slaRepairStartHours: number;
  @Column({ name: 'sla_repair_done_hrs', type: 'integer', default: 336 })
  slaRepairDoneHours: number;
  @Column({ name: 'liability_bearer', type: 'varchar', length: 20, default: 'provider' })
  liabilityBearer: string; // provider | platform

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
  @Column({ type: 'integer', default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
