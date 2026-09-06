import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { TechnicianServiceVerificationStatus } from './technician-service.entity';

// ADR-0018 §8 — تأهيل الفني بمستوى الفئة/التخصص (trade) بدل خدمة بخدمة. مطابق لـ
// infra/migrations/0148_technician_categories.sql. **إضافة جنب technician_services مش بديل
// ليها** — الأهلية بقت "خدمة معتمدة مباشرة OR فئة الخدمة معتمدة"، الاتنين ساريين معًا (راجع
// technician-eligibility.sql.ts وmatching.service.ts وassistant-matching.service.ts). بتستخدم
// نفس enum التحقق بتاع technician_services (technician_service_verification_status) — نفس
// سير عمل المراجعة بالحرف (تصريح ذاتي → pending_verification → موافقة/رفض/إيقاف أدمن).
@Entity('technician_categories')
export class TechnicianCategory {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean;

  @Column({
    name: 'verification_status',
    type: 'enum',
    enum: TechnicianServiceVerificationStatus,
    enumName: 'technician_service_verification_status',
    default: TechnicianServiceVerificationStatus.PENDING_VERIFICATION,
  })
  verificationStatus: TechnicianServiceVerificationStatus;

  @Column({ name: 'is_self_declared', type: 'boolean', default: true })
  isSelfDeclared: boolean;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true })
  reviewedByUserId: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
