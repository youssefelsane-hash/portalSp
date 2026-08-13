import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateRoleDto {
  // snake_case داخلي — identifier ثابت مستخدم في audit logs/كود، مش المعروض للمستخدم
  // (display_name). نفس نمط أسماء الأدوار النظامية الموجودة (super_admin, ops_manager, ...).
  @IsString()
  @Length(2, 60)
  @Matches(/^[a-z][a-z0-9_]*$/, { message: 'اسم الدور لازم يكون snake_case (حروف صغيرة وأرقام و_ بس)' })
  name: string;

  @IsString()
  @Length(2, 120)
  display_name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
