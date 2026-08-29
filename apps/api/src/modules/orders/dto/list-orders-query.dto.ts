import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { OrderStatus, OrderType } from '../entities/order.entity';

export class ListOrdersQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  order_status?: OrderStatus;

  /**
   * بحث برقم الطلب (docs/08 §67) — طلب المالك: «لما أحب أدور على أي طلب قديم أدور عليه وألاقيه…
   * يبقى معايا رقم الطلب وأدور في السيرش ألاقيه بسهولة».
   *
   * بحث جزئي غير حسّاس لحالة الأحرف على `order_number` — الأدمن غالبًا بينسخ جزء من الرقم أو
   * بيكتبه من ورقة، فمطابقة تامة بس كانت هتخلّي الخانة عديمة الفايدة عمليًا.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  // فلتر أصل الطلب (migration 0124/0176) — 'true' = طلبات متولّدة تلقائيًا من خطط متكررة بس
  // (recurring_template_id مش null)، 'false' = الطلبات العادية (حجز يدوي/كول سنتر/إعادة زيارة/
  // طوارئ) بس. الغياب = الكل. قيم نصية لأن query strings كلها strings.
  @IsOptional()
  @IsIn(['true', 'false'])
  recurring?: 'true' | 'false';

  // فلتر نوع الطلب (ADR-0051، docs/08 §96) — الأدمن مكانش عنده أي طريقة يفصل إعادات الزيارة عن
  // باقي الطلبات، وهي بالظبط النوع اللي محتاج متابعة (مجاني، مربوط بفني بعينه، وراه أثر مالي).
  @IsOptional()
  @IsEnum(OrderType)
  order_type?: OrderType;

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
