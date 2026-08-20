import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

// إدارة طاقم الطلب من الأدمن (Script 4 §22-29، §38-41).
export class AddCrewMemberDto {
  @IsUUID()
  technician_id: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  role_label: string;
}

export class RemoveCrewMemberDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class ReplaceCrewMemberDto {
  @IsUUID()
  new_technician_id: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;

  // لو مش مبعوت، بياخد role_label بتاع العضو القديم (نفس الدور، فني تاني بس).
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  role_label?: string;
}

// تغيير قائد الطلب (docs/08 §35، ADR-0021 §5).
export class ReassignLeaderDto {
  @IsUUID()
  new_leader_technician_id: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
