import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { TechnicianLevel } from '../../technicians/entities/technician-profile.entity';

export enum PricingModel {
  FIXED = 'fixed',
  HOURLY = 'hourly',
  PER_UNIT = 'per_unit',
  INSPECTION_THEN_QUOTE = 'inspection_then_quote',
  // محرك تسعير ديناميكي (docs/08 §1، ADR-0001) — الخدمة عندها حقول وقواعد تسعير مخصصة
  // (service_pricing_fields/service_pricing_rules) بدل base_price_cents ثابت. راجع
  // apps/api/src/modules/pricing/README.md للتفاصيل الكاملة.
  FORMULA = 'formula',
}
// ملحوظة: قيمة enum قديمة 'worker_rate' كانت هنا (ADR-0029، هجرة حجز الشغالة القديمة) — اتشالت
// من TS بعد إلغاء البنية دي بالكامل (ADR-0031). قيمة الـPostgres enum type نفسها (`pricing_model`)
// فضلت من غير تعديل عمدًا (إعادة بناء enum type محتاج إعادة إنشاء العمود، خطر أكبر من فايدة لقيمة
// مالهاش أي صف بيستخدمها بعد التنظيف) — orphaned بس غير مؤذية، موثّق هنا بدل ما تتنسى.

@Entity('services')
export class Service {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 120 })
  nameAr: string;

  @Column({ name: 'name_en', type: 'varchar', length: 120, nullable: true })
  nameEn: string | null;

  @Column({ type: 'varchar', length: 120, unique: true })
  slug: string;

  @Column({ name: 'short_description_ar', type: 'varchar', length: 255, nullable: true })
  shortDescriptionAr: string | null;

  @Column({ name: 'full_description_ar', type: 'text', nullable: true })
  fullDescriptionAr: string | null;

  @Column({ name: 'icon_url', type: 'text', nullable: true })
  iconUrl: string | null;

  @Column({ name: 'pricing_model', type: 'enum', enum: PricingModel, enumName: 'pricing_model' })
  pricingModel: PricingModel;

  @Column({ name: 'base_price_cents', type: 'integer' })
  basePriceCents: number;

  @Column({ name: 'inspection_fee_cents', type: 'integer', default: 0 })
  inspectionFeeCents: number;

  @Column({ name: 'min_price_cents', type: 'integer', nullable: true })
  minPriceCents: number | null;

  @Column({ name: 'max_price_cents', type: 'integer', nullable: true })
  maxPriceCents: number | null;

  @Column({ name: 'unit_name_ar', type: 'varchar', length: 40, nullable: true })
  unitNameAr: string | null;

  @Column({ name: 'estimated_duration_minutes', type: 'smallint', nullable: true })
  estimatedDurationMinutes: number | null;

  @Column({ name: 'warranty_days', type: 'smallint', default: 0 })
  warrantyDays: number;

  @Column({ name: 'requires_photos', type: 'boolean', default: false })
  requiresPhotos: boolean;

  @Column({ name: 'allows_scheduling', type: 'boolean', default: true })
  allowsScheduling: boolean;

  @Column({ name: 'allows_emergency', type: 'boolean', default: false })
  allowsEmergency: boolean;

  // هيكل الحجز الجديد (docs/06 §1، docs/07 الجزء أ) — أي أوضاع حجز ("فرد"/"اعتماد") مسموحة
  // لهذه الخدمة تحديدًا. نفس نمط allows_scheduling/allows_emergency بالظبط: بديل عن قايمة
  // كاتيجوريز منفصلة لكل نوع (فجوة موثّقة اتحلّت — راجع docs/07 §الفجوات المفتوحة #1).
  @Column({ name: 'allows_individual', type: 'boolean', default: true })
  allowsIndividual: boolean;

  @Column({ name: 'allows_team', type: 'boolean', default: false })
  allowsTeam: boolean;

  // محرك الحجز الموحّد — قدرة دفع أولى (ADR-0026، docs/08 §42 Phase A.1). نفس نمط
  // allows_individual/allows_team بالحرف: علم مباشر على Service مش جدول تهيئة منفصل. الافتراضي
  // true عمدًا — صفر تغيير سلوك لأي خدمة موجودة، والأدمن يقفلها صراحة لخدمة بعينها (شغالة/مربية
  // لاحقًا مثلاً، Phase A.4).
  @Column({ name: 'cash_allowed', type: 'boolean', default: true })
  cashAllowed: boolean;

  // سياسة إيداع (ADR-0027، docs/08 §42 Phase A.3) — نفس نمط cash_allowed بالحرف. الافتراضي false
  // متعمّد (صفر تغيير سلوك). depositPercentage محصورة 1-99 على مستوى الـDB (migration 0164) ولازم
  // تكون موجودة لو depositRequired=true — القيد ده مفروض بالـCHECK constraint وبالتحقق في
  // AdminCatalogService.
  @Column({ name: 'deposit_required', type: 'boolean', default: false })
  depositRequired: boolean;

  @Column({ name: 'deposit_percentage', type: 'numeric', precision: 5, scale: 2, nullable: true })
  depositPercentage: string | null;

  // قدرة "نطاق أيام مرن" (ADR-0028، docs/08 §42 Phase A.2) — نفس نمط cash_allowed بالحرف. الافتراضي
  // true عمدًا: الخيار متاح فعليًا لكل خدمة اليوم بلا فحص، فالعلم ده تحويل الوضع الحالي لقدرة صريحة
  // مش قيد جديد. صفر لمس لمنطق حل النطاق نفسه (orders.service.ts) — بوابة دخول بس.
  @Column({ name: 'allows_date_range_booking', type: 'boolean', default: true })
  allowsDateRangeBooking: boolean;

  // قدرة "الحجز المتكرر" — نفس نمط cash_allowed/allows_date_range_booking بالحرف (migration 0176).
  // false (الافتراضي) يعني العميل مش شايف خيارات التكرار خالص في مسار الحجز ولا يقدر ينشئ قالب
  // متكرر للخدمة دي (RecurringOrdersService + OrdersService.create() بيرفضوا بوضوح). true يعني
  // العميل يقدر يختار أسبوعي/شهري/سنوي وقت الحجز، والقالب بيتولّد بنفس الـtransaction بتاعة الطلب.
  @Column({ name: 'allows_recurring_booking', type: 'boolean', default: false })
  allowsRecurringBooking: boolean;

  // سياسة إظهار المرشّحين المتعارضين جدوليًا (ADR-0030، docs/08 §42) — نفس نمط cash_allowed
  // بالحرف. الافتراضي false عمدًا (سلوك جديد كليًا، صفر خدمة موجودة بتعرض مرشّحين متعارضين
  // النهاردة). صفر قراءة له في أي استعلام لسه (Slice B/C من ADR-0030).
  @Column({ name: 'show_unavailable_providers', type: 'boolean', default: false })
  showUnavailableProviders: boolean;

  // دقة الوقت (ADR-0031 Slice B) — نفس نمط cash_allowed بالحرف. الافتراضي false (الجدولة تبقى
  // بمستوى اليوم، ADR-0018) — true يعني العميل لازم يحدد بداية + مدة بالساعات وقت الحجز، وفحص
  // التعارض بيبقى بدقة ساعة حقيقية (OrdersService.create()) بدل يوم بس.
  @Column({ name: 'requires_precise_schedule', type: 'boolean', default: false })
  requiresPreciseSchedule: boolean;

  // 3 أوضاع توقيت جديدة (ADR-0032، migration 0172) — تبادلية مع requires_precise_schedule فوق
  // ومع بعض (CHECK constraint chk_services_scheduling_mode_exclusive على مستوى الـDB: على الأكتر
  // وضع واحد فعّال). كل وضع بيطلب حقول مختلفة وقت إنشاء الطلب (OrdersService.create()):
  // requiresStartTimeOnly → scheduled_at بس، requiresHoursOnly → duration_hours بس،
  // requiresStartAndEnd → scheduled_at + scheduled_end_at (عمود جديد على orders) الاتنين.
  @Column({ name: 'requires_start_time_only', type: 'boolean', default: false })
  requiresStartTimeOnly: boolean;

  @Column({ name: 'requires_hours_only', type: 'boolean', default: false })
  requiresHoursOnly: boolean;

  @Column({ name: 'requires_start_and_end', type: 'boolean', default: false })
  requiresStartAndEnd: boolean;

  @Column({
    name: 'min_technician_level',
    type: 'enum',
    enum: TechnicianLevel,
    enumName: 'technician_level',
    default: TechnicianLevel.NEW,
  })
  minTechnicianLevel: TechnicianLevel;

  @Column({ name: 'commission_percentage', type: 'numeric', precision: 5, scale: 2, default: 15.0 })
  commissionPercentage: string;

  @Column({ name: 'display_order', type: 'smallint', default: 0 })
  displayOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'launch_phase', type: 'smallint', default: 1 })
  launchPhase: number;

  // Script 3 §7/§12 — مرادفات/عبارات عامية للبحث بلغة طبيعية (بديل بسيط عن AI classification،
  // migration 0129).
  @Column({ name: 'search_keywords', type: 'text', array: true, default: () => "'{}'" })
  searchKeywords: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
