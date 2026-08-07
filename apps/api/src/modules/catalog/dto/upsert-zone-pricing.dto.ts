import { IsInt, IsNumber, IsOptional, IsPositive, IsUUID, Min } from 'class-validator';

export class UpsertZonePricingDto {
  @IsUUID()
  service_zone_id: string;

  @IsInt()
  @Min(0)
  price_cents: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  inspection_fee_cents?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  surge_multiplier?: number;
}
