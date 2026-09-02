import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AssessmentFeeCreditMode, AssessmentRoutePolicy, PriceCertaintyMode, PricingModel } from '../entities/service.entity';
import { SCHEDULE_PRECISIONS, SchedulePrecision } from '../schedule-precision';
import { TechnicianLevel } from '../../technicians/entities/technician-profile.entity';

export class CreateServiceDto {
  @IsUUID()
  category_id: string;

  @IsString()
  @MaxLength(120)
  name_ar: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name_en?: string;

  @IsString()
  @Length(2, 120)
  slug: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  short_description_ar?: string;

  @IsOptional()
  @IsString()
  full_description_ar?: string;

  @IsOptional()
  @IsString()
  icon_url?: string;

  @IsOptional()
  @IsString()
  featured_icon_url?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  featured_name_ar?: string | null;

  @IsEnum(PricingModel)
  pricing_model: PricingModel;

  @IsInt()
  @Min(0)
  base_price_cents: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  inspection_fee_cents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  min_price_cents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  max_price_cents?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  unit_name_ar?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity_min?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity_max?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity_step?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  quantity_precision?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  estimated_duration_minutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  warranty_days?: number;

  @IsOptional()
  @IsBoolean()
  requires_photos?: boolean;

  @IsOptional()
  @IsBoolean()
  allows_scheduling?: boolean;

  @IsOptional()
  @IsBoolean()
  allows_emergency?: boolean;

  // ADR-0046 — الإعلان التلقائي. الافتراضي في القاعدة `false`، فحتى لو الحقل ده اتساب فاضي
  // الخدمة ما بتتعلنش — الأدمن لازم يفعّلها صراحةً.
  @IsOptional()
  @IsBoolean()
  is_promotable?: boolean;

  // هيكل الحجز الجديد (docs/06 §1) — أي أوضاع حجز ("أفراد"/"اعتماد") مسموحة لهذه الخدمة.
  @IsOptional()
  @IsBoolean()
  allows_individual?: boolean;

  @IsOptional()
  @IsBoolean()
  allows_team?: boolean;

  // محرك الحجز الموحّد — قدرة دفع أولى (ADR-0026، docs/08 §42 Phase A.1). false يعني الخدمة دي
  // لازم تتقفل بكارت/InstaPay مقدّم، الكاش مرفوض صراحة وقت إنشاء الطلب (orders.service.ts).
  @IsOptional()
  @IsBoolean()
  cash_allowed?: boolean;

  // سياسة إيداع (ADR-0027، docs/08 §42 Phase A.3) — true يعني الطلب لازم دفع مقدّم إلكتروني
  // إجباري (كاش مرفوض صراحة وقت إنشاء الطلب، orders.service.ts) بمبلغ deposit_percentage% من
  // الإجمالي، والباقي يتحصّل تلقائيًا بعد اكتمال الشغل (نفس مسار البند الإضافي، ADR-0015).
  @IsOptional()
  @IsBoolean()
  deposit_required?: boolean;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Max(99)
  deposit_percentage?: number;

  // قدرة "نطاق أيام مرن" (ADR-0028، docs/08 §42 Phase A.2) — false يعني scheduled_at_range_end
  // مرفوض صراحة وقت إنشاء الطلب (orders.service.ts)، والعميل هيشوف كارت "مرن" مختفي في customer-app.
  @IsOptional()
  @IsBoolean()
  allows_date_range_booking?: boolean;

  // قدرة "الحجز المتكرر" (migration 0176) — false (الافتراضي) يعني مفيش خيارات تكرار للخدمة دي
  // خالص (لا في واجهة العميل ولا في POST /me/recurring-orders ولا repeat_frequency في POST /orders).
  @IsOptional()
  @IsBoolean()
  allows_recurring_booking?: boolean;

  // سياسة إظهار المرشّحين المتعارضين جدوليًا (ADR-0030، docs/08 §42) — true يعني فني مؤهّل بس
  // متعارض مع الموعد المطلوب يفضل ظاهر بحالة "مش متاح للفترة دي" بدل ما يختفي تمامًا.
  @IsOptional()
  @IsBoolean()
  show_unavailable_providers?: boolean;

  /**
   * دقة الموعد (ADR-0060 §4) — **حقل واحد بدل أربع بوليانات تبادلية**.
   *
   * الأربعة القدام كانوا محتاجين قيد تبادل على مستوى الداتابيز + تحقق صريح في الخدمة عشان
   * مايتفعّلش أكتر من واحد، وكان لسه ممكن يوصلوا كلهم `false` أو كلهم `true` من كولر غلطان.
   * الحقل الواحد بيخلي «وضع واحد بالظبط» **مستحيل يتكسر** بدل ما يبقى مفروض بقاعدة.
   */
  @IsOptional()
  @IsIn(SCHEDULE_PRECISIONS)
  schedule_precision?: SchedulePrecision;

  @IsOptional()
  @IsEnum(TechnicianLevel)
  min_technician_level?: TechnicianLevel;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(32767)
  display_order?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(32767)
  launch_phase?: number;

  // بحث بلغة طبيعية بلا AI (docs/16 §7، migration 0129) — مرادفات/كلمات عامية العميل ممكن
  // يكتبها بدل الاسم الرسمي (مثلاً "سخان مياه" لخدمة "صيانة سخانات"). GIN index على العمود ده.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  search_keywords?: string[];

  // ===== ADR-0063/0066 — سياسة تحديد السعر والمعاينة (migration 0247) =====
  // كل الحقول دي اختيارية بالكامل: الافتراضيات في الداتابيز آمنة (`confirmed_price` + كل مسارات
  // التقييم مقفولة)، فأي خدمة قديمة أو أي كولر مابيبعتهاش بتفضل بسلوكها بالحرف.

  /** سعر مؤكد / نطاق تقديري / محتاج تقييم — ده اللي بيحدد شكل الخطوة الأولى عند العميل. */
  @IsOptional()
  @IsEnum(PriceCertaintyMode)
  price_certainty_mode?: PriceCertaintyMode;

  @IsOptional()
  @IsEnum(AssessmentRoutePolicy)
  assessment_route_policy?: AssessmentRoutePolicy;

  @IsOptional()
  @IsBoolean()
  remote_assessment_enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  remote_assessment_fee_cents?: number;

  @IsOptional()
  @IsBoolean()
  onsite_assessment_enabled?: boolean;

  @IsOptional()
  @IsEnum(AssessmentFeeCreditMode)
  assessment_fee_credit_mode?: AssessmentFeeCreditMode;

  /** نسبة الخصم بالعشر-آلاف (bps) — 10000 = 100%. بتُقرأ بس لو الوضع `percentage`. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  assessment_fee_credit_bps?: number;

  @IsOptional()
  @IsBoolean()
  onsite_assessor_executes_work?: boolean;

  /** صلاحية عرض السعر بالدقايق — إعداد إداري، مش رقم مخبّي في الكود (بند 51 من السكربت). */
  @IsOptional()
  @IsInt()
  @Min(1)
  quote_validity_minutes?: number;

  /** حدود **العرض** للعميل — منفصلة عمدًا عن min/max اللي بتقصّ ناتج المعادلة (بند 29). */
  // بند 10 — نسب النطاق الديناميكي. لو اتظبطت بتغلب الحقول الثابتة تحت.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(99.99)
  range_percent_below?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  range_percent_above?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  display_price_min_cents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  display_price_max_cents?: number;

  @IsOptional()
  @IsBoolean()
  require_admin_review_above_range?: boolean;

  /** العتبة اللي فوقها الزيادة بتحتاج مراجعة إدارة — قابلة للضبط، مش 20% ثابتة (بند 34). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  max_quote_increase_without_admin_review_bps?: number;
}
