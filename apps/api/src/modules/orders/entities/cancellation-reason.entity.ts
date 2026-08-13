import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum CancellationAppliesTo {
  CUSTOMER = 'customer',
  TECHNICIAN = 'technician',
  ADMIN = 'admin',
}

@Entity('cancellation_reasons')
export class CancellationReason {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'reason_ar', type: 'varchar', length: 200 })
  reasonAr: string;

  @Column({ name: 'reason_en', type: 'varchar', length: 200 })
  reasonEn: string;

  @Column({ name: 'applies_to', type: 'enum', enum: CancellationAppliesTo, enumName: 'cancellation_applies_to' })
  appliesTo: CancellationAppliesTo;

  @Column({ name: 'charges_fee', type: 'boolean', default: false })
  chargesFee: boolean;

  @Column({ name: 'fee_percentage', type: 'numeric', precision: 5, scale: 2, default: 0 })
  feePercentage: string;

  @Column({ name: 'affects_technician_score', type: 'boolean', default: false })
  affectsTechnicianScore: boolean;

  // سياسة إلغاء الفني (ADR-0006) — لو true، النص الحر (reason) بقى إجباري مع السبب ده (مثلاً "أخرى").
  @Column({ name: 'requires_free_text', type: 'boolean', default: false })
  requiresFreeText: boolean;

  @Column({ name: 'display_order', type: 'smallint', default: 0 })
  displayOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
