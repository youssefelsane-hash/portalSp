import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

// name مش موجود هنا عمدًا — تغيير الـidentifier بعد الإنشاء ممنوع حتى للأدوار غير النظامية
// (مراجع خارجية محتملة زي notification_routing_rules.role_name)، الاسم المعروض للمستخدم
// (display_name) هو اللي قابل للتعديل بحرية.
export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  display_name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
