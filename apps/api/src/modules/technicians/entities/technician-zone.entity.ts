import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق لـ infra/migrations/0005_customers_technicians.sql — مناطق عمل الفني (matching بيستخدمها
// فعلياً في findEligibleTechnicians). كانت فجوة موثّقة صراحة: التعيين كان يدوي عبر SQL مباشر
// تماماً، مفيش أي entity/endpoint ليها قبل كده.
@Entity('technician_zones')
export class TechnicianZone {
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

  @Column({ name: 'service_zone_id', type: 'uuid' })
  serviceZoneId: string;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
