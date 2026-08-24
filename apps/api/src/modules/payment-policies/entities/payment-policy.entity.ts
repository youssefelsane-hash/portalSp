import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// سياسة دفع يديرها الأدمن (شروط التقسيط/الدفع بعد الخدمة/الإيداع...) — المحتوى نفسه في
// payment_policy_versions (versioning إجباري: القبول بيرتبط بنسخة محددة، والنسخ التاريخية
// **مش بتتكتب فوقها أبدًا**). الاستهداف مبسط عمدًا: applies_to + خدمة/فئة اختيارية — مفيش
// rule-builder معقد لحد ما الأعمال تطلبه فعلاً.
@Entity('payment_policies')
export class PaymentPolicy {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ type: 'varchar', length: 60, unique: true })
  slug: string;

  @Column({ name: 'title_ar', type: 'varchar', length: 200 })
  titleAr: string;

  /**
   * مين بيشتغل على مين:
   * - installment: شروط التقسيط (بتقبل وقت تقديم طلب التقسيط)
   * - postpaid_service: شروط الدفع بعد الخدمة (بتطلب وقت إنشاء الطلب لو العميل مش دافع مقدّم)
   * - deposit / manual_transfer / general: بوابات إضافية حسب الحاجة.
   */
  @Column({ name: 'applies_to', type: 'varchar', length: 30 })
  appliesTo: string;

  /** استهداف اختياري بخدمة بعينها — null = كل الخدمات (أو الفئة لو محددة). */
  @Column({ name: 'target_service_id', type: 'uuid', nullable: true })
  targetServiceId: string | null;

  /** استهداف اختياري بفئة — أدنى أولوية من target_service_id. */
  @Column({ name: 'target_category_id', type: 'uuid', nullable: true })
  targetCategoryId: string | null;

  /** required=true: الباك-إند بيرفض أي checkout/تقديم من غير قبول النسخة الحالية. */
  @Column({ name: 'is_required', type: 'boolean', default: true })
  isRequired: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'display_order', type: 'smallint', default: 0 })
  displayOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** نسخة نصية من السياسة — immutable بموجب التصميم (مفيش endpoint تعديل، نشر نسخة جديدة بس). */
@Entity('payment_policy_versions')
export class PaymentPolicyVersion {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'policy_id', type: 'uuid' })
  policyId: string;

  @Column({ type: 'integer' })
  version: number;

  @Column({ name: 'body_ar', type: 'text' })
  bodyAr: string;

  @Column({ name: 'published_at', type: 'timestamptz', default: () => 'now()' })
  publishedAt: Date;
}

/**
 * إثبات القبول — سجل غير قابل للتعديل: مين قبل **أنهي نسخة** من أنهي سياسة، في أنهي سياق
 * (طلب/تقسيط)، إمتى. تغيير السياسة بعدين بينشر نسخة جديدة؛ القبولات القديمة بتفضل مربوطة
 * بالنسخة اللي اتحطت فعلاً — ممنوع إعادة كتابة الموافقات التاريخية.
 */
@Entity('payment_policy_acceptances')
export class PaymentPolicyAcceptance {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'policy_version_id', type: 'uuid' })
  policyVersionId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** 'order' | 'installment_application' — بيسمح بتوسيع السياقات مستقبلًا بلا migration. */
  @Column({ name: 'context_type', type: 'varchar', length: 30 })
  contextType: string;

  @Column({ name: 'context_id', type: 'uuid' })
  contextId: string;

  @Column({ name: 'accepted_at', type: 'timestamptz', default: () => 'now()' })
  acceptedAt: Date;
}
