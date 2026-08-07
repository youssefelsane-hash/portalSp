import { IsString, Length } from 'class-validator';

export class AssignRoleDto {
  @IsString()
  @Length(2, 60)
  role_name: string;
}
