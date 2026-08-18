import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

// إعادة جدولة عامة من الأدمن (Script 4 Part K §42) — سبب إلزامي (بعكس RescheduleOrderDto
// بتاع العميل نفسه)، لازم للتدقيق بما إن ده تدخّل من طرف تالت في طلب مش بتاعه.
export class AdminRescheduleOrderDto {
  @IsUUID()
  new_slot_id: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
