import { IsDateString, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { BookingMode } from '../entities/order.entity';
import { RecurringOrderFrequency } from '../entities/recurring-order-template.entity';

export class CreateRecurringTemplateDto {
  @IsUUID()
  service_id: string;

  @IsUUID()
  address_id: string;

  @IsOptional()
  @IsEnum(BookingMode)
  booking_mode?: BookingMode;

  @IsOptional()
  @IsUUID()
  requested_technician_id?: string;

  // "اعتماد" — تفضيل شركة/فريق محدد يتكرر مع كل طلب متولّد (مسموح بس مع booking_mode=team،
  // نفس قيد CreateOrderDto). تفضيل مش ضمان — لو الشركة بقت غير نشطة وقت التوليد الطلب بيرجع
  // للتوزيع العادي زي أي طلب تاني.
  @IsOptional()
  @IsUUID()
  requested_technician_company_id?: string;

  @IsEnum(RecurringOrderFrequency)
  frequency: RecurringOrderFrequency;

  // أول موعد تنفيذ — لازم يكون في المستقبل. المواعيد اللي بعد كده بتتحسب تلقائيًا من التردد.
  @IsDateString()
  starts_at: string;

  // مدخلات التسعير لخدمات pricing_model=formula (نفس شكل CreateOrderDto.field_values) — بتتخزن
  // مع القالب وبتتبعت مع كل طلب متولّد. **مدخلات مش سعر**: القيمة الفعلية بتتحسب من محرك
  // التسعير الحي وقت توليد كل طلب.
  @IsOptional()
  @IsObject()
  field_values?: Record<string, string | number | boolean>;

  // إجبارية لخدمة requiresPreciseSchedule/requiresHoursOnly (نفس قيود CreateOrderDto بالحرف).
  @IsOptional()
  @IsInt()
  @Min(1)
  duration_hours?: number;

  // إجبارية لخدمة requiresStartAndEnd بس (نفس قيود CreateOrderDto بالحرف).
  @IsOptional()
  @IsDateString()
  scheduled_end_at?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  problem_description?: string;

  // دفع قبل التوزيع (ADR-0013) لكل طلب يتولّد من القالب ده — اختياري، لو مبعتش كل طلب متولّد
  // بيدفع بعد الشغل زي زمان (كاش/محفظة). نفس قيود CreateOrderDto.payment_method بالظبط.
  @IsOptional()
  @IsIn(['card', 'instapay'])
  payment_method?: 'card' | 'instapay';
}
