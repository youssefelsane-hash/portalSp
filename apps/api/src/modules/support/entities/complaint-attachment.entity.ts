import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('complaint_attachments')
export class ComplaintAttachment {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'complaint_id', type: 'uuid' })
  complaintId: string;

  @Column({ name: 'file_url', type: 'text' })
  fileUrl: string;

  // مفتاح التخزين (docs/08 §19 بند 9) — لو موجود، نمط getUrl(key) بيتستخدم وقت القراءة بدل
  // file_url الثابت. NULL لأي صف قديم قبل الإصلاح.
  @Column({ name: 'storage_key', type: 'text', nullable: true })
  storageKey: string | null;

  @Column({ name: 'file_type', type: 'varchar', length: 40, nullable: true })
  fileType: string | null;

  @Column({ name: 'uploaded_by_user_id', type: 'uuid' })
  uploadedByUserId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
