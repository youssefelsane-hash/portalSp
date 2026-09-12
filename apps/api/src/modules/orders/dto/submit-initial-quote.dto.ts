import { IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

// معاينة-ثم-سعر (ADR-0044، docs/08 §73 بند 1) — الفني بيحدد السعر بعد ما عاين المكان فعليًا.
export class SubmitInitialQuoteDto {
  @IsInt()
  @Min(1)
  @Max(100_000_00) // 100,000 جنيه سقف دفاعي — نفس سقف QuoteItemDto.unit_price_cents
  quoted_amount_cents: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  /**
   * **تشخيص إجباري** (ADR-0084 §2، طلب مالك §139 بند ٣) — «يعمل معاينة يبقى فيه خانة إجبارية».
   *
   * ده أول سعر بيتأسس للطلب بعد ما الفني عاين المكان بنفسه، والعميل بيوافق عليه أو يلغي.
   * عرض سعر بلا تشخيص مكتوب مالوش أي قيمة مراجعة — لا للعميل اللي بيقرر، ولا للأدمن اللي
   * بيدوّر بعدين على «إيه اللي ماشي مضبوط وإيه اللي فيه تلاعب».
   */
  @IsString()
  @Length(10, 4000)
  diagnosis: string;

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

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  required_technicians?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  required_assistants?: number;
}
