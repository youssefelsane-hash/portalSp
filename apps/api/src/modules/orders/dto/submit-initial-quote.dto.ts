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
}
