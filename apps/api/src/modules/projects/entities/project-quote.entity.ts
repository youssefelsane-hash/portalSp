import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('project_quotes')
export class ProjectQuote {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ type: 'integer', default: 1 })
  version: number;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: string; // draft | sent | approved | rejected | expired | superseded

  @Column({ name: 'work_lines', type: 'jsonb', default: '[]' })
  workLines: { description_ar: string; quantity: number; unit: string; unit_price_cents: number; total_cents: number }[];

  @Column({ name: 'material_lines', type: 'jsonb', default: '[]' })
  materialLines: { description_ar: string; responsibility: string; quantity: number; unit: string; unit_price_cents: number; total_cents: number }[];

  @Column({ name: 'total_work_cents', type: 'integer', default: 0 })
  totalWorkCents: number;
  @Column({ name: 'total_materials_cents', type: 'integer', default: 0 })
  totalMaterialsCents: number;
  @Column({ name: 'discount_cents', type: 'integer', default: 0 })
  discountCents: number;
  @Column({ name: 'total_cents', type: 'integer' })
  totalCents: number;
  @Column({ name: 'duration_days', type: 'integer', nullable: true })
  durationDays: number | null;

  @Column({ name: 'scope_included', type: 'text', nullable: true })
  scopeIncluded: string | null;
  @Column({ name: 'scope_excluded', type: 'text', nullable: true })
  scopeExcluded: string | null;
  @Column({ name: 'assumptions', type: 'text', nullable: true })
  assumptions: string | null;

  @Column({ name: 'proposed_company_id', type: 'uuid', nullable: true })
  proposedCompanyId: string | null;
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;
  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;
  @Column({ name: 'rejected_reason', type: 'text', nullable: true })
  rejectedReason: string | null;
  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
