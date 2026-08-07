import { IsBoolean, IsISO8601, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';

// مش PartialType(CreateEmployeeDto) عمداً — manager_user_id هنا لازم يقبل null صريح (نقل
// الموظف لأعلى الهيكل)، وده نوع مايتوافقش مع base type بتاع الحقل في CreateEmployeeDto.
export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  full_name?: string;

  @IsOptional()
  @IsString()
  @Length(2, 60)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  // null صريح = امسح المدير المباشر، undefined = مفيش تعديل
  @IsOptional()
  @IsUUID()
  manager_user_id?: string | null;

  @IsOptional()
  @IsISO8601()
  hire_date?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
