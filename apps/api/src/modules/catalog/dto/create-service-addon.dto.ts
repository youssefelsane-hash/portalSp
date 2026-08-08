import { IsInt, IsOptional, IsPositive, IsString, Length, Min } from 'class-validator';

export class CreateServiceAddonDto {
  @IsString()
  @Length(2, 120)
  name_ar: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  name_en?: string;

  @IsInt()
  @Min(0)
  price_cents: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  duration_minutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;
}
