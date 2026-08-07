import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';

export class CreateServiceCategoryDto {
  @IsOptional()
  @IsUUID()
  parent_category_id?: string;

  @IsString()
  @MaxLength(120)
  name_ar: string;

  @IsString()
  @MaxLength(120)
  name_en: string;

  @IsString()
  @Length(2, 120)
  slug: string;

  @IsOptional()
  @IsString()
  description_ar?: string;

  @IsOptional()
  @IsString()
  icon_url?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(32767)
  display_order?: number;

  @IsOptional()
  @IsBoolean()
  is_featured?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(32767)
  launch_phase?: number;
}
