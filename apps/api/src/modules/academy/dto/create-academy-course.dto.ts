import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateAcademyCourseDto {
  @IsString()
  @MaxLength(200)
  title_ar: string;

  @IsString()
  @MaxLength(200)
  title_en: string;

  @IsOptional()
  @IsString()
  description_ar?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  passing_score?: number;

  @IsOptional()
  @IsInt()
  display_order?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
