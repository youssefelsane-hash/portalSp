import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// خطة تقسيط يديرها الأدمن (migration 0177) — كتالوج تهيئة بالكامل: عدد أقساط/فاصل/تمويل/مقدم/
// حدود أهلية، بدون أي قيم hardcoded في الكود. التغييرات بتطبق prospectively — الطلبات الموجودة
// بتحتفظ بـsnapshot مالي خاص بيها في installment_applications.
@Entity('installment_plans')
export class InstallmentPlan {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 120 })
  nameAr: string;

  @Column({ name: 'installment_count', type: 'integer' })
  installmentCount: number;

  /** الفاصل بين الأقساط بالأيام (30 ≈ شهري، 7 = أسبوعي) — مرونة كاملة بدل enum شهري hardcoded. */
  @Column({ name: 'interval_days', type: 'integer', default: 30 })
  intervalDays: number;

  @Column({ name: 'financing_percentage', type: 'numeric', precision: 5, scale: 2, default: 0 })
  financingPercentage: string;

  @Column({ name: 'fixed_fee_cents', type: 'integer', default: 0 })
  fixedFeeCents: number;

  @Column({ name: 'down_payment_percentage', type: 'numeric', scale: 2, precision: 5, default: 0 })
  downPaymentPercentage: string;

  @Column({ name: 'min_order_amount_cents', type: 'integer', nullable: true })
  minOrderAmountCents: number | null;

  @Column({ name: 'max_order_amount_cents', type: 'integer', nullable: true })
  maxOrderAmountCents: number | null;

  /** مفتاح provider من PaymentProviderRegistry المسموح للتحصيل (paymob حاليًا). */
  @Column({ name: 'allowed_provider', type: 'varchar', length: 40, default: 'paymob' })
  allowedProvider: string;

  // v1 معماري: المراجعة البشرية إجبارية دائمًا — الكود مايلتزمش بقيمة false مهما كانت القيمة مخزنة.
  @Column({ name: 'requires_admin_approval', type: 'boolean', default: true })
  requiresAdminApproval: boolean;

  @Column({ name: 'requires_saved_card', type: 'boolean', default: true })
  requiresSavedCard: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /**
   * **`@DeleteDateColumn` مش `@Column` عادي** (تدقيق شامل 2026-09-20).
   *
   * خطط التقسيط بتتوقف بـ`is_active=false` مش بالحذف — بس العمود موجود بقاعدة البيانات
   * من أول يوم (اتفاقية docs/01 §1.3: كل جدول فيه deleted_at).
   * وبـ`@Column` عادي، TypeORM **مابيفلترش** الصفوف المحذوفة في `find()` — فأول ما حد يبدأ
   * يحذف حذف ناعم يوم، الصفوف المحذوفة بترجع تظهر في القراءات بصمت. دلوقتي الجدول ده متوافق
   * مع الـ43 جدول التانيين اللي عندهم `deleted_at` في المشروع.
   */
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
