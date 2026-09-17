import { Transform, Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { OrderPaymentStatus, OrderStatus, OrderType } from '../entities/order.entity';
import { OrderBucket, OrderDateField, OrderScope } from '../order-scope';

export class ListOrdersQueryDto {
  /**
   * **إيه الطلبات اللي عايز أشوفها؟** (ADR-0103) — محور منفصل تمامًا عن `sort`.
   *
   * `current` هو الافتراضي عن قصد: الأدمن الصبح بيشوف تشغيل اليوم مش مكتمل السنة اللي فاتت.
   * قبل كده مكانش فيه scope خالص، فـ`sort=soonest` كان بيرتّب **كل** التاريخ بأقرب تنفيذ —
   * والمكتمل من سنة موعده أقدم فبيطلع الأول (بلاغ المالك بالحرف).
   */
  @IsOptional()
  @IsIn(['current', 'completed', 'all'])
  scope?: OrderScope = 'current';

  /**
   * اختصار تشغيلي جوّه الـscope — **كله مشتقّ**، مفيش حالة ولا عمود جديد.
   * `overdue` = الموعد عدّى والطلب لسه غير نهائي.
   */
  @IsOptional()
  @IsIn(['today', 'tomorrow', 'next7', 'upcoming', 'overdue', 'unassigned'])
  bucket?: OrderBucket;

  /**
   * **التاريخ المقصود** لـ`from`/`to` (ADR-0103). قبل كده كان `placed_at` **دايمًا** بلا اختيار،
   * فـ«عايز أشوف ٢٠–٣٠ سبتمبر» كان بيجاوب على سؤال واحد بس من اتنين مختلفين تمامًا: «اللي
   * هيتنفّذ في الفترة» مقابل «اللي اتعمل في الفترة».
   */
  @IsOptional()
  @IsIn(['scheduled_at', 'placed_at', 'completed_at'])
  date_field?: OrderDateField = 'scheduled_at';

  @IsOptional()
  @IsEnum(OrderStatus)
  order_status?: OrderStatus;

  /**
   * فلتر حالات **متعدد** — الأدمن بيحتاج «بيدوّر على فني» + «مستني قبول» مع بعض.
   * `order_status` المفرد باقي للتوافق مع أي لينك محفوظ.
   */
  @IsOptional()
  @IsArray()
  @IsEnum(OrderStatus, { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  statuses?: OrderStatus[];

  /** حالة الدفع — الأدمن بيدوّر على «خلص شغل ومادفعش» كتير. */
  @IsOptional()
  @IsEnum(OrderPaymentStatus)
  payment_status?: OrderPaymentStatus;

  /**
   * حالة الطاقم — `incomplete` معناها العدد المطلوب أكبر من المملوء فعلاً (نفس قاعدة
   * `computeCrewComposition`: القائد +1، والأعضاء بـ`crew_slot`).
   */
  @IsOptional()
  @IsIn(['incomplete'])
  crew?: 'incomplete';

  @IsOptional()
  @IsUUID()
  service_id?: string;

  @IsOptional()
  @IsUUID()
  service_zone_id?: string;

  @IsOptional()
  @IsUUID()
  technician_id?: string;

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
