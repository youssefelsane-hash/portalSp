import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * سياسة تجنيد الشركة (ADR-0086، طلب مالك §141 بند ٨).
 *
 * > «عند كل بروفايل شركة، من عندي أنا كأدمن أحدد هل الشركة دي يحق لها لما يجيلها شغلانة وتحتاج
 * >  تدعو فنيين أو مساعدين، تدعوهم من الفنيين اللي على المنصة كمان، ولا هم community مقفولة.»
 */
export class SetCompanyRecruitmentPolicyDto {
  @IsBoolean()
  allows_external_recruitment: boolean;

  /** سبب التغيير — بيتسجّل في `audit_log` (نفس فلسفة note في معامل السعر وعلامة التوثيق). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
