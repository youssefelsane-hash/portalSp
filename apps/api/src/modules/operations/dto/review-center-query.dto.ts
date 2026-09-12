import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

// مركز المراجعة (ADR-0084) — فلاتر المراجعة الحقيقية: «أدوّر ورا صنايعي معيّن»، و«وريني
// المعلّق بس»، وعلى أي مدى زمني.
export class ReviewCenterQueryDto {
  @IsOptional()
  @IsUUID()
  technician_id?: string;

  // الاستعلام بيوصل كنص في الـquery string — التحويل هنا عشان `@IsBoolean()` تشتغل فعلاً بدل
  // ما 'false' النصية تعدّي كـtruthy.
  @IsOptional()
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value))
  @IsBoolean()
  pending_only?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === null || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(365)
  since_days?: number;
}
