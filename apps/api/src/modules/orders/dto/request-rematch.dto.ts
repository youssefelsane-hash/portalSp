import { IsOptional, IsUUID } from 'class-validator';

// سياسة إلغاء الفني (ADR-0006) — العميل بيطلب إعادة مطابقة صراحة بعد ما الطلب يتحول
// needs_technician_reselection. requested_technician_id تفضيل بس مش ضمان، نفس فلسفة الحقل
// المطابق في CreateOrderDto بالحرف.
export class RequestRematchDto {
  @IsOptional()
  @IsUUID()
  requested_technician_id?: string;
}
