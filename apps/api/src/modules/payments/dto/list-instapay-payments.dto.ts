import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * فلتر سجل تحويلات InstaPay (طلب مالك 2026-09-10) — الطابور والسجل نفس المسار.
 *
 * الافتراضي `all` عمدًا: الشاشة الواحدة هي اللي المالك طلبها («التحويلة تفضل ظاهرة بعد
 * التأكيد»)، والمعلّق بيتصدّر الترتيب في الاستعلام نفسه فمفيش تراجع في سرعة اتخاذ القرار.
 */
export class ListInstaPayPaymentsDto {
  @IsOptional()
  @IsIn(['pending', 'decided', 'all'])
  status?: 'pending' | 'decided' | 'all';

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
