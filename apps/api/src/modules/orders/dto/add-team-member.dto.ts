import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class AddTeamMemberDto {
  @IsUUID()
  technician_id: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  role_label: string;
}
