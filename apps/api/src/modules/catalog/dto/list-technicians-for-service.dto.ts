import { IsOptional, IsUUID } from 'class-validator';

export class ListTechniciansForServiceDto {
  @IsUUID()
  address_id: string;

  // سياسة إلغاء الفني (docs/10) — بيستخدمه العميل وقت اختيار فني بديل بعد ما فني لغى، عشان
  // القايمة متعرضش نفس الفني اللي لغى تاني (اختياري، مش مؤثر على مسار الاختيار قبل الحجز العادي).
  @IsOptional()
  @IsUUID()
  exclude_technician_id?: string;
}
