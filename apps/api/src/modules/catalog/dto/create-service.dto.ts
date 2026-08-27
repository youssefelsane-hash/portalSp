import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
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
import { PricingModel } from '../entities/service.entity';
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

  // دقة الوقت (ADR-0031 Slice B) — true يعني العميل لازم يحدد بداية + مدة بالساعات وقت الحجز
  // (duration_hours إجباري)، وفحص التعارض بدقة ساعة حقيقية بدل يوم بس.
  @IsOptional()
  @IsBoolean()
  requires_precise_schedule?: boolean;

  // 3 أوضاع توقيت جديدة (ADR-0032) — تبادلية مع requires_precise_schedule فوق ومع بعض (CHECK
  // constraint chk_services_scheduling_mode_exclusive على مستوى الـDB + تحقق صريح في
  // AdminCatalogService.assertSchedulingModeExclusive()).
  @IsOptional()
  @IsBoolean()
  requires_start_time_only?: boolean;

  @IsOptional()
  @IsBoolean()
  requires_hours_only?: boolean;

  @IsOptional()
  @IsBoolean()
  requires_start_and_end?: boolean;

  @IsOptional()
  @IsEnum(TechnicianLevel)
  min_technician_level?: TechnicianLevel;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Max(100)
  commission_percentage?: number;

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
}
