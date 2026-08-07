import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum TechnicianDocumentType {
  NATIONAL_ID_FRONT = 'national_id_front',
  NATIONAL_ID_BACK = 'national_id_back',
  CRIMINAL_RECORD = 'criminal_record',
  PROFESSIONAL_CERTIFICATE = 'professional_certificate',
  PHOTO = 'photo',
  DRIVING_LICENSE = 'driving_license',
  VEHICLE_LICENSE = 'vehicle_license',
}

export enum DocumentReviewStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

// مطابق لـ infra/migrations/0005_customers_technicians.sql
@Entity('technician_documents')
export class TechnicianDocument {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @Column({ name: 'document_type', type: 'enum', enum: TechnicianDocumentType, enumName: 'technician_document_type' })
  documentType: TechnicianDocumentType;

  @Column({ name: 'file_url', type: 'text' })
  fileUrl: string;

  @Column({ name: 'file_size_bytes', type: 'integer', nullable: true })
  fileSizeBytes: number | null;

  @Column({ name: 'mime_type', type: 'varchar', length: 60, nullable: true })
  mimeType: string | null;

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

  @Column({ name: 'expires_at', type: 'date', nullable: true })
  expiresAt: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
