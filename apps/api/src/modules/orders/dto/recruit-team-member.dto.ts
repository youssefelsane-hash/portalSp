import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// تجنيد فريق ذاتي (docs/08 §31) — role_label اختياري عمدًا (بعكس AddTeamMemberDto الإلزامي)،
// افتراضي "عضو فريق" لو مبعوتش — التجنيد فوري بضغطة واحدة، مش فورم.
export class RecruitTeamMemberDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  role_label?: string;
}
