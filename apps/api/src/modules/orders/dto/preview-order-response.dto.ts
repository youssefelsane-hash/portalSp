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
  /** الإجمالي قبل أي خصم = base_price_cents + inspection_fee_cents + emergency_surcharge_cents + addons_total_cents. */
  subtotal_before_discount_cents: number;
  discount_cents: number;
  /** 'promo_code' | 'building' | null — مصدر الخصم المطبّق (متبادلان استبعاديًا، نفس قيد ADR-0003). */
  discount_source: 'promo_code' | 'building' | null;
  /** الإجمالي النهائي = subtotal_before_discount_cents - discount_cents. نفس القيمة بالحرف اللي
   * POST /orders هيحسبها كـ total_amount_cents لو اتبعتت نفس المدخلات بالظبط. */
  total_amount_cents: number;
  estimated_duration_days: number | null;
}
