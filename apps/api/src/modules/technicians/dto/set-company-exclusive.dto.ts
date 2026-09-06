import { IsBoolean } from 'class-validator';

/**
 * **«حصري للشركة»** (ADR-0080) — طلب مالك صريح (2026-09-06): «زرار عند كل فني داخل في شركة…
 * لو متفعل، الفني ده ما بيظهرش أصلًا إن هو فرد لوحده… بيتم اختياره فقط عن طريق الشركة بتاعته».
 */
export class SetCompanyExclusiveDto {
  @IsBoolean()
  company_exclusive: boolean;
}
