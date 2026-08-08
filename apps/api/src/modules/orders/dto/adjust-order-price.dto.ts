import { Type } from 'class-transformer';
import { IsInt, IsString, Min, MinLength, MaxLength } from 'class-validator';

export class AdjustOrderPriceDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  new_total_amount_cents: number;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
