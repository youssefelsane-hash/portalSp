import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق بالحرف لـ infra/migrations/0026_technician_companies.sql
@Entity('technician_companies')
export class TechnicianCompany {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'owner_user_id', type: 'uuid', unique: true })
  ownerUserId: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ name: 'commercial_registration_number', type: 'varchar', length: 60, nullable: true })
  commercialRegistrationNumber: string | null;

  /**
   * ADR-0042 (docs/08 §64.و) — مضاعف سعر الشغل لحجوزات الشركة دي. بيحل **محل** مضاعف مستوى/فئة
   * الفني (مش فوقه). 1.00 = السعر الأساسي زي ما كان، وده الافتراضي لكل الشركات الموجودة.
   */
  @Column({ name: 'price_multiplier', type: 'numeric', precision: 4, scale: 2, default: 1 })
  priceMultiplier: string;

  /**
   * **سياسة تجنيد الشركة** (ADR-0086، طلب مالك §141 بند ٨): هل الشركة تقدر تجنّد من مجمع
   * المنصة كله لطلباتها، ولا مقفولة على طاقمها؟
   *
   * **`true` افتراضيًا** (migration 0353، docs/08 §163): «مش عايزين تكون الشركة مغلقة على
   * نفسها» — طلب مالك صريح بيعكس الافتراضي الأصلي في ADR-0086. القفل بقى **استثناء** بقرار
   * أدمن مسجّل في `audit_logs`، مش وضع تلقائي بيسري بالسكوت.
   *
   * والقيد بيسري بس على الطلب اللي `orders.assigned_company_id` بتاعته = الشركة دي: نفس الفني
   * على طلب **خاص بيه** بيتعامل كمستقل تمامًا (بند ٩، `resolveAssignedCompanyId`).
   */
  @Column({ name: 'allows_external_recruitment', type: 'boolean', default: true })
  allowsExternalRecruitment: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  // ADR-0039 (docs/08 §62.1) — العلامة الزرقاء للشركة: نفس مِنحة الفني بالظبط، بنفس المسار الإداري.
  @Column({ name: 'is_trust_verified', type: 'boolean', default: false })
  isTrustVerified: boolean;

  @Column({ name: 'trust_verified_at', type: 'timestamptz', nullable: true })
  trustVerifiedAt: Date | null;

  @Column({ name: 'trust_verified_by', type: 'uuid', nullable: true })
  trustVerifiedBy: string | null;

  @Column({ name: 'trust_verified_note', type: 'varchar', length: 500, nullable: true })
  trustVerifiedNote: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
