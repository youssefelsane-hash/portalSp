import { IsBooleanString, IsEnum, IsOptional } from 'class-validator';
import { RefundStatus } from '../entities/refund.entity';

export class ListRefundsQueryDto {
  @IsOptional()
  @IsEnum(RefundStatus)
  status?: RefundStatus;

  /**
   * الاستردادات اللي النظام عملها لوحده (إلغاء طلب مدفوع مقدّمًا) — طلب مالك صريح
   * 2026-09-11: «لما الاسترداد بيتقبل تلقائيًا من النظام لازم يبان للأدمن عشان يتابع».
   */
  @IsOptional()
  @IsBooleanString()
  automatic?: string;

  /** الفلوس المعلّقة بس: صف `processing` عبر البوابة مستني موظف يثبّت النتيجة (AUD-012). */
  @IsOptional()
  @IsBooleanString()
  needs_reconciliation?: string;
}

/** `IsBooleanString` بيسيب القيمة نص — التحويل هنا عشان المستدعي ما يكررش المقارنة. */
export function asBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value === 'true';
}
