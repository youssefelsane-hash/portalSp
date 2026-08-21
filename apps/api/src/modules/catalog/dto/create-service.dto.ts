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
