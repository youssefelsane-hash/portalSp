import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// تجنيد فريق ذاتي (docs/08 §31/§35) — role_label اختياري عمدًا (بعكس AddTeamMemberDto الإلزامي)،
// افتراضي "عضو فريق"/"مساعد" لو مبعوتش — التجنيد فوري بضغطة واحدة، مش فورم. role إجباري (docs/08
// §35) — أي دور القائد بيكمّل دلوقتي (فني/مساعد)، افتراضي 'technician' لو مبعوتش (توافق خلفي).
export class RecruitTeamMemberDto {
  @IsOptional()
  @IsIn(['technician', 'assistant'])
  role?: 'technician' | 'assistant';

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  role_label?: string;
}
