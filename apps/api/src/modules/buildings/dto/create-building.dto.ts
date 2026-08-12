import { IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateBuildingDto {
  @IsString()
  @MaxLength(200)
  name_ar: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  address_text?: string;

  @IsOptional()
  @IsUUID()
  city_id?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discount_percentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minimum_monthly_orders?: number;
}
