import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * تسجيل سداد مديونية حصل برّه التطبيق (ADR-0041، docs/08 §63.أ2).
 *
 * `external_reference` اختياري بس متوقّع بشدة لأي طريقة غير الكاش — رقم التحويل هو الإثبات
 * الوحيد اللي بيربط الصف ده بواقعة حقيقية.
 */
export class RecordDebtSettlementDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount_cents: number;

  @IsIn(['cash', 'instapay', 'bank_transfer'])
  method: 'cash' | 'instapay' | 'bank_transfer';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  external_reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
