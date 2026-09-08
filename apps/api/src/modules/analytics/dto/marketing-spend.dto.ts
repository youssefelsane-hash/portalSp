import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpsertMarketingSpendDto {
  /** أي تاريخ في الشهر المقصود — الخدمة بتطبّعه لأول يوم فيه. */
  @IsDateString()
  month: string;

  @IsString()
  @MaxLength(40)
  channel: string;

  /** بالقرش زي كل مبالغ المشروع (docs/01 §1.3) — مفيش أي مبلغ float في النظام. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amount_cents: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
