import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum SkillLevel {
  BEGINNER = 'beginner',
  STANDARD = 'standard',
  EXPERT = 'expert',
}

// Script 4 §2-7 — تصريح مهارات ذاتي: DECLARED/PENDING_VERIFICATION اتدمجوا في حالة واحدة
// (pending_verification) لأن مفيش خطوة تحقق مستندات منفصلة عن قرار الأدمن نفسه لسه (نفس فلسفة
// technician-verification-state-machine.ts's الحالات الوسيطة اللي مالهاش endpoints حقيقية).
export enum TechnicianServiceVerificationStatus {
  PENDING_VERIFICATION = 'pending_verification',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  SUSPENDED = 'suspended',
}

// مطابق لـ infra/migrations/0006_catalog.sql — الفنيين المؤهلين لكل خدمة (matching بيستخدمها فعلياً)
@Entity('technician_services')
export class TechnicianService {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'technician_id', type: 'uuid', nullable: true })
  technicianId: string | null;

  /**
   * **ADR-0079 — الصف ده صف «نطاق منفّذ»، مش «نطاق فني» بس.**
   *
   * مالك الصف واحد بالظبط: فني فرد (`technicianId`) أو شركة (`companyId`) — مفروض على مستوى
   * قاعدة البيانات بـ`chk_*_owner`. ده اللي بيخلي الشركة تتضبط بنفس الجدول ونفس شرط الأهلية
   * ونفس نقطة الإدارة بتاعت الفني، بدل نسخة موازية بتنحرف مع الوقت (طلب مالك صريح: «دخّلها
   * على نفس اللاين»).
   *
   * `technicianId` بقى `string | null` عشان النوع يقول الحقيقة: صف الشركة مالوش فني. كل
   * مسارات الفني القايمة بتفلتر `technician_id = X`، فصفوف الشركة مستحيل توصلها.
   */
  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  @Column({ name: 'service_id', type: 'uuid' })
  serviceId: string;

  @Column({ name: 'skill_level', type: 'enum', enum: SkillLevel, enumName: 'skill_level', default: SkillLevel.STANDARD })
  skillLevel: SkillLevel;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'completed_count', type: 'integer', default: 0 })
  completedCount: number;

  @Column({ name: 'average_rating', type: 'numeric', precision: 3, scale: 2, nullable: true })
  averageRating: string | null;

  @Column({ name: 'tested_at', type: 'timestamptz', nullable: true })
  testedAt: Date | null;

  @Column({
    name: 'verification_status',
    type: 'enum',
    enum: TechnicianServiceVerificationStatus,
    enumName: 'technician_service_verification_status',
    default: TechnicianServiceVerificationStatus.APPROVED,
  })
  verificationStatus: TechnicianServiceVerificationStatus;

  @Column({ name: 'is_self_declared', type: 'boolean', default: false })
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
