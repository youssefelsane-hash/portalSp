import { IsIn, IsOptional } from 'class-validator';

// اختيار وسيلة الدفع للمبلغ الإضافي المعتمد (docs/08 §22 بند 8) — بس لو الطلب مدفوع مسبقًا
// إلكترونيًا (order.payment_status='paid')، وإلا القيمة دي متجاهلة تمامًا (الكاش زي ما هو دايماً).
// 'electronic' هي الافتراضي (نفس السلوك القديم قبل البند ده — صفر تغيير سلوكي لو الحقل متبعتش).
export class ApproveQuoteItemsDto {
  @IsOptional()
  @IsIn(['cash', 'electronic'])
  payment_choice?: 'cash' | 'electronic';
}
