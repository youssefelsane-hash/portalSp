import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ProductivityQueryDto {
  // فترة التقييم (شهور) — لو مبعتش، الافتراضي من `productivity.default_evaluation_period_months`.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number;
}
