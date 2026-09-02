import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

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

  @IsOptional()
  @IsString()
  @MaxLength(4000)
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
