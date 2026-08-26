import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { OrderStatus } from '../entities/order.entity';

export class ListOrdersQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  order_status?: OrderStatus;

  // فلتر أصل الطلب (migration 0124/0176) — 'true' = طلبات متولّدة تلقائيًا من خطط متكررة بس
  // (recurring_template_id مش null)، 'false' = الطلبات العادية (حجز يدوي/كول سنتر/إعادة زيارة/
  // طوارئ) بس. الغياب = الكل. قيم نصية لأن query strings كلها strings.
  @IsOptional()
  @IsIn(['true', 'false'])
  recurring?: 'true' | 'false';

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  /**
   * ترتيب القايمة (docs/08 §63.ب5). الافتراضي `newest` = الأحدث طلبًا.
   *
   * `soonest` = الأقرب تنفيذًا — طلب المالك الصريح: «جزء تاني للطلبات اللي الكستمر طلبها من زمن
   * ولكن وقت تنفيذها حان خلاص». بيرتّب بـ`scheduled_at` تصاعديًا (الأقرب الأول).
   */
  @IsOptional()
  @IsIn(['newest', 'soonest'])
  sort?: 'newest' | 'soonest' = 'newest';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  per_page?: number = 20;
}
