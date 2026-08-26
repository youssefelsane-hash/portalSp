import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * منح/سحب علامة التوثيق الزرقاء (ADR-0039، docs/08 §62.1).
 *
 * `note` اختياري بس بيتسجّل في `audit_log` وفي العمود نفسه — السبب اللي الأدمن كتبه وقت القرار،
 * عشان لما حد يسأل بعد سنة "ليه الفني ده موثّق؟" يبقى فيه إجابة مكتوبة مش ذاكرة بشر.
 */
export class SetTrustBadgeDto {
  @IsBoolean()
  granted: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
