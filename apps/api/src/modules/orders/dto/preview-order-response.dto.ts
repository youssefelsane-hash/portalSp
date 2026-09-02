// تفصيل السعر الكامل قبل تأكيد الحجز (docs/08 §1/§2، طلب صريح من المالك: "لازم breakdown واضح
// مش رقم واحد غامض، ونفس المدخلات اللي هتتبعت وقت التأكيد الفعلي — مفيش فرق بين المعاينة والمحصّل").
// كل حقل هنا بيطابق بالحرف نفس الحساب في OrdersService.create() (نفس estimate() + نفس منطق
// addons/discount) — أي تعديل في create() لازم يتعدّل هنا بالتوازي.
export interface PreviewOrderAddonDto {
  id: string;
  name_ar: string;
  price_cents: number;
}

export interface PreviewOrderResponseDto {
  /** السعر الأساسي/المحسوب (ثابت بعد ضرب المنطقة والمستوى، أو ناتج معادلة formula). */
  base_price_cents: number;
  inspection_fee_cents: number;
  /** حدود السعر التقديرية لخدمات formula بس — null لباقي نماذج التسعير. */
  min_price_cents: number | null;
  max_price_cents: number | null;
  /** رسوم الطوارئ الإضافية — 0 لو مش booking_mode=emergency. */
  emergency_surcharge_cents: number;
  emergency_sla_minutes: number | null;
  addons: PreviewOrderAddonDto[];
  addons_total_cents: number;
  optional_warranty: {
    id: string;
    name_ar: string;
    coverage_months: number;
    price_cents: number;
  } | null;
  warranty_price_cents: number;
  /** الإجمالي قبل أي خصم = base_price_cents + inspection_fee_cents + emergency_surcharge_cents + addons_total_cents. */
  subtotal_before_discount_cents: number;
  discount_cents: number;
  /** 'promo_code' | 'building' | null — مصدر الخصم المطبّق (متبادلان استبعاديًا، نفس قيد ADR-0003). */
  discount_source: 'promo_code' | 'building' | null;
  /** الإجمالي النهائي = subtotal_before_discount_cents - discount_cents + warranty_price_cents. نفس القيمة بالحرف اللي
   * POST /orders هيحسبها كـ total_amount_cents لو اتبعتت نفس المدخلات بالظبط. */
  total_amount_cents: number;
  estimated_duration_days: number | null;
  /** مضاعف سعر مستوى الفني (docs/08) — 1 لو الفني مش معروف وقت المعاينة (مطابقة تلقائية).
   * base_price_cents فوق أصلاً مضروب فيه — الحقل ده للعرض/الشفافية بس، مش لإعادة الحساب يدويًا. */
  level_price_multiplier: number;
  /** سياسة إيداع (ADR-0027، docs/08 §42 Phase A.3) — null لخدمة deposit_required=false. لو موجود،
   * ده المبلغ اللي هيتحصّل وقت تأكيد الحجز (بكارت/InstaPay إجباري)، والباقي بيتحصّل بعد الشغل. */
  deposit_amount_cents: number | null;
  /** المبلغ المطلوب فعليًا وقت تأكيد الحجز = deposit_amount_cents لو موجود، وإلا total_amount_cents كامل. */
  due_now_cents: number;
  /** = total_amount_cents - deposit_amount_cents، أو null لو مفيش إيداع (يبقى remaining=0 ضمنيًا،
   * الإجمالي كله اتحصّل أو هيتحصّل بعد الشغل زي أي طلب عادي). */
  remaining_amount_cents: number | null;
  price_certainty_mode: 'confirmed_price' | 'estimated_range' | 'assessment_required';
  display_price_min_cents: number | null;
  display_price_max_cents: number | null;
  remote_assessment_fee_cents: number;
  booking_mode: 'individual' | 'team' | 'emergency';
  service_zone_id: string;
  duration_minutes: number | null;
  required_technicians: number | null;
  required_assistants: number | null;
}
