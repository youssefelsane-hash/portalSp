import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** نوع العضو داخل الطاقم — نفس قيم `order_team_members.member_type` بالحرف. */
export type CrewMemberType = 'team_member' | 'assistant';
export const CREW_MEMBER_TYPES: CrewMemberType[] = ['team_member', 'assistant'];

// إدارة طاقم الطلب من الأدمن (Script 4 §22-29، §38-41).
export class AddCrewMemberDto {
  @IsUUID()
  technician_id: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  role_label: string;

  /**
   * docs/08 §70 (بلاغ مالك): `role_label` نص حر للعرض بس — العدّادات وحالة "الطاقم ناقص"
   * بتتحسب من `member_type`. من غير الحقل ده كان الأدمن يكتب "مساعد" في الدور والصف ينزل
   * `team_member` (الافتراضي في الداتابيز)، فنقص المساعدين ما بيتسدّش أبدًا. الافتراضي
   * `team_member` عشان النداءات القديمة تفضل بنفس السلوك بالحرف.
   */
  @IsOptional()
  @IsIn(CREW_MEMBER_TYPES)
  member_type?: CrewMemberType;
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
