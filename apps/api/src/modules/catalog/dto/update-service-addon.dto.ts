import { IsBoolean, IsInt, IsOptional, IsPositive, IsString, Length, Min } from 'class-validator';

export class UpdateServiceAddonDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name_ar?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  name_en?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  price_cents?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  duration_minutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
