import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * بند 35 — «تعديل السعر بعد التشخيص».
 *
 * `reason` إجباري مش اختياري: ده سعر بيتغيّر على عميل وافق على غيره، فلازم يكون معاه سبب مكتوب
 * يشوفه العميل والأدمن في سجل الطلب.
 */
export class SubmitDiagnosisRevisionDto {
  @IsInt()
  @Min(1)
  new_amount_cents: number;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  diagnosis?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  scope_included?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  scope_excluded?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(43_200)
  estimated_duration_minutes?: number;
}
