import { IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateServiceZoneDto {
  @IsUUID()
  city_id: string;

  @IsString()
  @MaxLength(120)
  name_ar: string;

  @IsString()
  @MaxLength(120)
  name_en: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Max(10)
  surge_multiplier?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  min_order_amount_cents?: number;
}
