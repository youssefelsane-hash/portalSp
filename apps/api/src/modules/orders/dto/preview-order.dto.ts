import { ArrayMaxSize, ArrayUnique, IsArray, IsEnum, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { BookingMode } from '../entities/order.entity';

// معاينة السعر الحقيقي قبل تأكيد الحجز (docs/08 §1، طلب صريح: "عرض السعر قبل التأكيد لازم
// يطابق بالظبط اللي هيتحصّل"). نفس الحقول المؤثرة في السعر بتاعة CreateOrderDto بالظبط —
// عمدًا من غير حقول التنفيذ (scheduled_at, requested_technician_id, ...) لأنها مش بتأثر على السعر.
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
}
