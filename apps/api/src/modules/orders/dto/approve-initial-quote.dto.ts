import { IsIn, IsOptional } from 'class-validator';

// نفس نمط ApproveQuoteItemsDto بالحرف — اختيار وسيلة الدفع للمبلغ اللي اتحدد بعد المعاينة،
// بس لو رسم المعاينة اتحصّل إلكترونيًا بالفعل (order.payment_status='paid').
export class ApproveInitialQuoteDto {
  @IsOptional()
  @IsIn(['cash', 'electronic'])
  payment_choice?: 'cash' | 'electronic';
}
