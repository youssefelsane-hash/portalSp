import { IsISO8601, IsOptional, IsPhoneNumber, IsString, IsUUID, Length, MaxLength } from 'class-validator';

export class CreateEmployeeDto {
  @IsPhoneNumber(undefined)
  phone_number: string;

  @IsString()
  @Length(2, 120)
  full_name: string;

  @IsString()
  @Length(2, 60)
  department: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsUUID()
  manager_user_id?: string;

  @IsOptional()
  @IsISO8601()
  hire_date?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // اختياري: منح أول دور وقت الإنشاء مباشرة بدل خطوة تانية منفصلة عبر POST /admin/users/:id/roles
  // مش @IsIn بقايمة ثابتة عمداً — الأدوار نفسها ديناميكية (roles.manage)، الاسم بيتحقق من القاعدة في السيرفيس
  @IsOptional()
  @IsString()
  @Length(2, 60)
  initial_role_name?: string;
}
