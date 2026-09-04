import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type ProjectStatus =
  | 'draft' | 'survey_requested' | 'survey_scheduled' | 'quote_preparing'
  | 'awaiting_customer_approval' | 'awaiting_deposit' | 'active' | 'paused'
  | 'awaiting_milestone_approval' | 'handover_pending' | 'completed'
  | 'cancelled' | 'disputed';

@Entity('projects')
export class Project {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'project_number', type: 'varchar', length: 24 })
  projectNumber: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, nullable: true })
  idempotencyKey: string | null;

  @Column({ name: 'address_id', type: 'uuid' })
  addressId: string;

  @Column({ name: 'city_id', type: 'uuid', nullable: true })
  cityId: string | null;

  @Column({ name: 'project_type', type: 'enum', enumName: 'project_type' })
  projectType: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 200 })
  nameAr: string;

  @Column({ name: 'description_ar', type: 'text', nullable: true })
  descriptionAr: string | null;

  @Column({ type: 'varchar', length: 40 })
  status: ProjectStatus;

  @Column({ name: 'budget_estimate_cents', type: 'integer', nullable: true })
  budgetEstimateCents: number | null;

  @Column({ name: 'approved_quote_total_cents', type: 'integer', nullable: true })
  approvedQuoteTotalCents: number | null;
  @Column({ name: 'total_work_value_cents', type: 'integer', default: 0 })
  totalWorkValueCents: number;
  @Column({ name: 'total_materials_value_cents', type: 'integer', default: 0 })
  totalMaterialsValueCents: number;
  @Column({ name: 'warranty_paid_cents', type: 'integer', default: 0 })
  warrantyPaidCents: number;
  @Column({ name: 'paid_cents', type: 'integer', default: 0 })
  paidCents: number;
  @Column({ name: 'retained_cents', type: 'integer', default: 0 })
  retainedCents: number;
  @Column({ name: 'released_cents', type: 'integer', default: 0 })
  releasedCents: number;
  @Column({ name: 'remaining_cents', type: 'integer', default: 0 })
  remainingCents: number;

  @Column({ name: 'assigned_company_id', type: 'uuid', nullable: true })
  assignedCompanyId: string | null;

  @Column({ name: 'survey_requested_at', type: 'timestamptz', nullable: true })
  surveyRequestedAt: Date | null;
  @Column({ name: 'survey_scheduled_at', type: 'timestamptz', nullable: true })
  surveyScheduledAt: Date | null;
  @Column({ name: 'expected_start', type: 'date', nullable: true })
  expectedStart: string | null;
  @Column({ name: 'expected_end', type: 'date', nullable: true })
  expectedEnd: string | null;
  @Column({ name: 'actual_start', type: 'date', nullable: true })
  actualStart: string | null;
  @Column({ name: 'actual_end', type: 'date', nullable: true })
  actualEnd: string | null;

  @Column({ name: 'paused_reason', type: 'text', nullable: true })
  pausedReason: string | null;
  @Column({ name: 'cancelled_reason', type: 'text', nullable: true })
  cancelledReason: string | null;
  @Column({ name: 'dispute_reason', type: 'text', nullable: true })
  disputeReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}

/** انتقالات الحالة المسموحة — صارمة، مفيش اختصار مباشر لـCOMPLETED. */
const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  draft:                        ['survey_requested', 'cancelled'],
  survey_requested:             ['survey_scheduled', 'cancelled'],
  survey_scheduled:             ['quote_preparing', 'cancelled'],
  quote_preparing:              ['awaiting_customer_approval', 'cancelled'],
  awaiting_customer_approval:   ['awaiting_deposit', 'quote_preparing', 'cancelled'],
  awaiting_deposit:             ['active', 'cancelled'],
  active:                       ['paused', 'awaiting_milestone_approval', 'handover_pending', 'disputed', 'cancelled'],
  paused:                       ['active', 'cancelled'],
  awaiting_milestone_approval:  ['active', 'disputed'],
  handover_pending:             ['completed', 'disputed'],
  completed:                    [],
  cancelled:                    [],
  disputed:                     ['active', 'cancelled'],
};

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return (PROJECT_TRANSITIONS[from] ?? []).includes(to);
}
