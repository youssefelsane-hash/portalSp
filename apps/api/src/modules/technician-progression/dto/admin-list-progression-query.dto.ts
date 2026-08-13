import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class AdminListProgressionQueryDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  is_eligible?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  needs_demotion_review?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  per_page?: number = 20;
}
