import { IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

// نفس نمط ApproveQuoteItemsDto بالحرف — اختيار وسيلة الدفع للمبلغ اللي اتحدد بعد المعاينة،
// بس لو رسم المعاينة اتحصّل إلكترونيًا بالفعل (order.payment_status='paid').
export class ApproveInitialQuoteDto {
  // العميل لازم يوافق على النسخة التي قرأها فعلاً. لا نعتمد على «أحدث عرض» ضمنيًا كي لا
  // تتحول ضغطة متأخرة إلى موافقة على سعر حدّثه الفني أو الإدارة أثناء فتح الشاشة.
  @IsUUID()
  quote_id!: string;

  @IsInt()
  @Min(1)
  quote_version!: number;

  @IsOptional()
  @IsIn(['cash', 'electronic'])
  payment_choice?: 'cash' | 'electronic';
}
