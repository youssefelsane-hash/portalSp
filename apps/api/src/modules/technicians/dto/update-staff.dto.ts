import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class UpdateStaffDto {
  @IsOptional()
  @IsIn(['manager', 'supervisor', 'worker'])
  team_role?: 'manager' | 'supervisor' | 'worker';

  // null صريح = شيل الفرع، undefined = مفيش تعديل
  @IsOptional()
  @IsUUID()
  branch_id?: string | null;
}
