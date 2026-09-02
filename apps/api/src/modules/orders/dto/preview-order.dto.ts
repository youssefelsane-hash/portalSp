import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { BookingMode } from '../entities/order.entity';

// معاينة السعر الحقيقي قبل تأكيد الحجز (docs/08 §1، طلب صريح: "عرض السعر قبل التأكيد لازم
// يطابق بالظبط اللي هيتحصّل"). نفس الحقول المؤثرة في السعر بتاعة CreateOrderDto — بما فيهم
// requested_technician_id وschedule_slot_id (بَقّة حقيقية اتلقطت: كان مضاعف سعر مستوى الفني
// بيتحسب صح في create() بس مش في المعاينة لو العميل اختار سلوت جدولة تحديدًا، فرق السعر بين
// المعاينة والطلب الفعلي كان ممكن يحصل). duration_hours موجود (ADR-0031 Slice B/H): بيأثر فعليًا
// على السعر لخدمات pricing_model=hourly.
//
// **`scheduled_at` اتضاف هنا مع ADR-0048** — التعليق القديم كان بيقول إنه مستبعد عمدًا لأنه
// "مش بيأثر على السعر"، وده **بقى غلط**: اليوم المختار هو اللي بيحدد الاستعجال، والاستعجال
// بيضيف رسوم الطوارئ. من غيره المعاينة كانت هتقول سعر والتحصيل ياخد سعر أعلى — بالظبط البَقّة
// اللي التعليق ده اتكتب أصلاً عشان يمنعها.
export class PreviewOrderDto {
  @IsUUID()
  service_id: string;

  @IsUUID()
  address_id: string;

  @IsOptional()
  @IsBoolean()
  request_remote_quote?: boolean;

  /**
   * **متجاهَل تمامًا (ADR-0048)** — الوضع بقى مشتق من `scheduled_at` وعدد العمال، مش مختار.
   * الحقل باقي عشان النسخ القديمة من التطبيقات اللي لسه بتبعته ما تتكسرش بـ400.
   */
  @IsOptional()
  @IsEnum(BookingMode)
  booking_mode?: BookingMode;

  /** اليوم المطلوب — بيحدد الاستعجال ومنه رسوم الطوارئ (ADR-0048). غيابه = "دلوقتي" = مستعجل. */
  @IsOptional()
  @IsDateString()
  scheduled_at?: string;

  /** نفس CreateOrderDto.scheduled_end_at لضمان أن المعاينة تحسب مدة البداية/النهاية من السيرفر. */
  @IsOptional()
  @IsDateString()
  scheduled_end_at?: string;

  /** ADR-0050 §4 — نفس `CreateOrderDto.period_start/period_end` بالحرف: المعاينة لازم تحسب
   * عدد شهور الفوترة بنفس الطريقة اللي الحجز الحقيقي هيحسبها، وإلا العميل بيشوف رقم وبيتحاسب
   * بغيره. */
  @IsOptional()
  @IsDateString()
  period_start?: string;

  @IsOptional()
  @IsDateString()
  period_end?: string;

  @IsOptional()
  @IsObject()
  field_values?: Record<string, string | number | boolean>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  addon_ids?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(24)
  promo_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  building_code?: string;

  // مضاعف سعر مستوى الفني (docs/08) — لو العميل اختار فني بعينه بالفعل قبل المعاينة (نفس شاشة
  // اختيار الفني)، السعر المعروض هنا لازم يطابق بالحرف اللي هيتحصّل فعليًا لو أكّد بنفس الفني ده.
  @IsOptional()
  @IsUUID()
  requested_technician_id?: string;

  // ADR-0042 (docs/08 §64.و) — لو العميل اختار **شركة**، سعرها بيتحسب بمعامل الشركة بدل مضاعف
  // المستوى. من غير الحقل ده كانت المعاينة بترجّع السعر الأساسي والحجز يتحصّل بسعر أعلى — نفس
  // "مفاجأة السعر" اللي كل مسار التسعير هنا متبني عشان يمنعها.
  @IsOptional()
  @IsUUID()
  requested_technician_company_id?: string;

  // نفس السبب بالظبط، لكن لسلوت جدولة محدد (GET /technicians/:id/schedule) — بيغلب
  // requested_technician_id لو الاتنين اتبعتوا مع بعض، نفس أولوية create() بالحرف.
  @IsOptional()
  @IsUUID()
  schedule_slot_id?: string;

  @IsOptional()
  @IsUUID()
  warranty_plan_id?: string;

  // نفس CreateOrderDto.pricing_quantity بالحرف لضمان أن المعاينة والحجز النهائي يستخدمان
  // نفس مدخلات محرك التسعير لخدمات "بالوحدة".
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  pricing_quantity?: number;

  // دقة الوقت (ADR-0031 Slice B/H) — نفس CreateOrderDto.duration_hours بالحرف.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  duration_hours?: number;
}
