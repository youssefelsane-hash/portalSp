import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { BOOKING_MODE_FILTER_VALUES, BookingModeFilter } from './list-services.dto';

export class ListTechniciansForServiceDto {
  @IsUUID()
  address_id: string;

  // مضاعف سعر مستوى الفني (docs/08) — لازم نعرف لو الحجز طوارئ عشان السعر النهائي المعروض لكل
  // فني مرشّح يشمل رسوم الطوارئ بالظبط زي اللي هيتحصّل فعليًا لو العميل أكّد بيه. نفس نمط
  // list-services.dto.ts's BookingModeFilter (تكرار بسيط بدل import من orders module).
  @IsOptional()
  @IsIn(BOOKING_MODE_FILTER_VALUES)
  booking_mode?: BookingModeFilter;

  // سياسة إلغاء الفني (docs/10) — بيستخدمه العميل وقت اختيار فني بديل بعد ما فني لغى، عشان
  // القايمة متعرضش نفس الفني اللي لغى تاني (اختياري، مش مؤثر على مسار الاختيار قبل الحجز العادي).
  @IsOptional()
  @IsUUID()
  exclude_technician_id?: string;
}
