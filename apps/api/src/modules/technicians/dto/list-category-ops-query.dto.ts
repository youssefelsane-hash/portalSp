import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { TechnicianLevel, TechnicianVerificationStatus } from '../entities/technician-profile.entity';

export class ListCategoryOpsQueryDto {
  @IsUUID()
  category_id: string;

  @IsOptional()
  @IsUUID()
  zone_id?: string;

  @IsOptional()
  @IsEnum(TechnicianVerificationStatus)
  verification_status?: TechnicianVerificationStatus;

  @IsOptional()
  @IsEnum(TechnicianLevel)
  level?: TechnicianLevel;

  // بحث بالاسم/كود الفني (docs/08 §36.12) — تعديل جراحي واحد إضافي على نفس نمط فلتر zone_id
  // الموجود بالفعل (تعليق الخدمة نفسها)، صفر منطق أهلية/تصنيف جديد.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

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
