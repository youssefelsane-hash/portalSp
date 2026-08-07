import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class AddStaffDto {
  @IsString()
  @Length(2, 20)
  technician_code: string;

  // مش owner عمداً — مالك واحد بس للشركة، بيتحدد وقت الإنشاء
  @IsIn(['manager', 'supervisor', 'worker'])
  team_role: 'manager' | 'supervisor' | 'worker';

  @IsOptional()
  @IsUUID()
  branch_id?: string;
}
