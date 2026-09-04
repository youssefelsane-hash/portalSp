import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

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
