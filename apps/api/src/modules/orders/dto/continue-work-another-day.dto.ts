import { IsDateString, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * استكمال الشغل يوم تاني (ADR-0047).
 *
 * السبب **إجباري ومش قصير**: هو اللي بيتعرض للعميل حرفيًا («قطعة غيار نادرة، محتاج أجيبها»).
 * سبب من كلمة واحدة أو فاضي بيخلّي الميزة تبان للعميل كتهرّب مش كشفافية.
 */
export class ContinueWorkAnotherDayDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  pause_reason: string;

  /** `YYYY-MM-DD` — الجدولة باليوم مش بالساعة (ADR-0018 §2). */
  @IsDateString()
  next_session_date: string;
}
