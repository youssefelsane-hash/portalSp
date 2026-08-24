import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('customer_warranties')
export class CustomerWarranty {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;
  @Column({ name: 'plan_version', type: 'integer' })
  planVersion: number;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;
  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  // Immutable snapshot
  @Column({ name: 'name_ar', type: 'varchar', length: 200 })
  nameAr: string;
  @Column({ name: 'warranty_type', type: 'varchar', length: 40 })
  warrantyType: string;
  @Column({ name: 'price_paid_cents', type: 'integer' })
  pricePaidCents: number;
  @Column({ name: 'coverage_months', type: 'integer' })
  coverageMonths: number;
  @Column({ name: 'coverage_days', type: 'integer', nullable: true })
  coverageDays: number | null;
  @Column({ name: 'max_coverage_cents', type: 'integer', nullable: true })
  maxCoverageCents: number | null;
  @Column({ name: 'max_claims', type: 'integer' })
  maxClaims: number;
  @Column({ name: 'terms_ar', type: 'text', nullable: true })
  termsAr: string | null;
  @Column({ name: 'exclusions_ar', type: 'text', nullable: true })
  exclusionsAr: string | null;

  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt: Date | null;
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
  @Column({ name: 'claims_used', type: 'integer', default: 0 })
  claimsUsed: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('warranty_claims')
export class WarrantyClaim {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'warranty_id', type: 'uuid' })
  warrantyId: string;
  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;
  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ type: 'varchar', length: 30, default: 'open' })
  status: string; // open | under_review | inspection_scheduled | approved | rejected | repair_in_progress | resolved | closed

  @Column({ name: 'defect_description', type: 'text' })
  defectDescription: string;
  @Column({ name: 'defect_discovered_at', type: 'date', nullable: true })
  defectDiscoveredAt: string | null;
  @Column({ name: 'attachments', type: 'jsonb', default: '[]' })
  attachments: { storage_key: string; uploaded_at: string }[];

  @Column({ name: 'resolution_notes', type: 'text', nullable: true })
  resolutionNotes: string | null;
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;
  @Column({ name: 'repair_order_id', type: 'uuid', nullable: true })
  repairOrderId: string | null;
  @Column({ name: 'original_provider_id', type: 'uuid', nullable: true })
  originalProviderId: string | null;
  @Column({ name: 'provider_deadline', type: 'timestamptz', nullable: true })
  providerDeadline: Date | null;
  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;
  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
