import { ArrayMaxSize, ArrayUnique, IsArray, IsEnum, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { BookingMode } from '../entities/order.entity';

// معاينة السعر الحقيقي قبل تأكيد الحجز (docs/08 §1، طلب صريح: "عرض السعر قبل التأكيد لازم
// يطابق بالظبط اللي هيتحصّل"). نفس الحقول المؤثرة في السعر بتاعة CreateOrderDto — بما فيهم
// requested_technician_id وschedule_slot_id (بَقّة حقيقية اتلقطت: كان مضاعف سعر مستوى الفني
// بيتحسب صح في create() بس مش في المعاينة لو العميل اختار سلوت جدولة تحديدًا، فرق السعر بين
// المعاينة والطلب الفعلي كان ممكن يحصل). عمدًا من غير حقول تنفيذ تانية زي scheduled_at اللي
// فعلاً مش بتأثر على السعر.
export class PreviewOrderDto {
  @IsUUID()
  service_id: string;

  @IsUUID()
  address_id: string;

  @IsOptional()
  @IsEnum(BookingMode)
  booking_mode?: BookingMode;

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

  // نفس السبب بالظبط، لكن لسلوت جدولة محدد (GET /technicians/:id/schedule) — بيغلب
  // requested_technician_id لو الاتنين اتبعتوا مع بعض، نفس أولوية create() بالحرف.
  @IsOptional()
  @IsUUID()
  schedule_slot_id?: string;
}
