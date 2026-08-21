import { IsString, Length } from 'class-validator';

export class InvitePreferredCrewMemberDto {
  @IsString()
  @Length(3, 20)
  member_technician_code: string;
}
