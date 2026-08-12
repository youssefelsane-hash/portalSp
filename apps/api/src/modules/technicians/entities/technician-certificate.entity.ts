import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { DocumentReviewStatus } from './technician-document.entity';

// مطابق لـ infra/migrations/0059_technician_certificates.sql
@Entity('technician_certificates')
export class TechnicianCertificate {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ name: 'issuer_name', type: 'varchar', length: 200, nullable: true })
  issuerName: string | null;

  @Column({ name: 'issued_at', type: 'date', nullable: true })
  issuedAt: string | null;

  @Column({ name: 'file_url', type: 'text' })
  fileUrl: string;

  @Column({
    name: 'review_status',
    type: 'enum',
    enum: DocumentReviewStatus,
    enumName: 'document_review_status',
    default: DocumentReviewStatus.PENDING,
  })
  reviewStatus: DocumentReviewStatus;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true })
  reviewedByUserId: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'display_order', type: 'smallint', default: 0 })
  displayOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
