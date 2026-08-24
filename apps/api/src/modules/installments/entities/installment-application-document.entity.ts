import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn } from 'typeorm';

// مستند KYC-like مرفوع على طلب تقسيط — نفس بنية technician_documents الآمنة بالحرف:
// storage key خاص + MIME allowlist + magic bytes (في السيرفس) + وصول أدمن مقيد بصلاحية
// مالية/KYC مع audit لكل فتح. retention: حذف ناعم عند رفض/إلغاء الطلب أو سياسة الاحتفاظ.
@Entity('installment_application_documents')
export class InstallmentApplicationDocument {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'application_id', type: 'uuid' })
  applicationId: string;

  /** مفتاح نوع حر مطابق لواحد من متطلبات الخطة (مثلاً national_id_front). */
  @Column({ name: 'doc_type', type: 'varchar', length: 40 })
  docType: string;

  @Column({ name: 'storage_key', type: 'text' })
  storageKey: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 80 })
  mimeType: string;

  @Column({ name: 'file_size_bytes', type: 'integer' })
  fileSizeBytes: number;

  @Column({ name: 'uploaded_by', type: 'uuid' })
  uploadedBy: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
