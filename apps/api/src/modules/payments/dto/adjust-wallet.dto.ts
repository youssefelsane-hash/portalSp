import { IsIn, IsInt, IsString, Length, Min } from 'class-validator';

// تصحيح محفظة يدوي (docs/08 §20 بند 5) — direction صريح بدل الاعتماد على إشارة رقم amount_cents
// (سهل الغلط فيه وقت الإدخال اليدوي، وواضح أكتر في أي log/شاشة أدمن).
export class AdjustWalletDto {
  @IsInt()
  @Min(1)
  amount_cents: number;

  // credit = زيادة رصيد المستخدم (تصحيح لصالحه/بونص)، debit = نقصه (تصحيح ضده/غرامة).
  @IsIn(['credit', 'debit'])
  direction: 'credit' | 'debit';

  @IsString()
  @Length(5, 500)
  reason_ar: string;
}
