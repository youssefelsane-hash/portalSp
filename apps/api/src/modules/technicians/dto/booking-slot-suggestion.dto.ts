import { IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SuggestedDaysQueryDto {
  @IsUUID()
  service_id!: string;

  /** العنوان مصدر النطاق — الخادم بيستنتج منه `service_zone_id` ومابيقبلوش من العميل. */
  @IsUUID()
  address_id!: string;

  /**
   * **مدة الشغلانة الحقيقية بالدقايق — ناتج محرك التسعير** (ADR-0100).
   *
   * منها بيتشتق **مدى الشغل** (`candidateSpanDaysFromSource()`)، وكل أيام المدى بتتفحص. يعني
   * شغل ٥ أيام بيرفض المنفّذ اللي مشغول في اليوم الخامس، مش بس اللي مشغول يوم البداية.
   *
   * لما تكون `null` المدى بيطلع **يوم واحد** وفحص الأيام الكاملة بيتعطّل فعليًا. التعليق القديم
   * هنا كان بيسمّي ده «أوسع شوية من الواقع» — وده وصف مش دقيق: لشغل ٥ أيام الاقتراح كان بيتحسب
   * على الخُمس. الرحلة بقت بتجمع تفاصيل الشغل **قبل** الموعد بالظبط عشان الرقم ده يبقى معروف هنا.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_080)
  duration_minutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  estimated_duration_days?: number;
}

export class SuggestedTimesQueryDto {
  @IsUUID()
  service_id!: string;

  @IsUUID()
  address_id!: string;

  /** اليوم اللي العميل اختاره، YYYY-MM-DD بتوقيت مصر. */
  @IsISO8601()
  day!: string;

  /**
   * نفس حد `SuggestedDaysQueryDto` (ADR-0100 §5). الحد القديم (`1440`) كان بيرفض أي شغلانة أطول
   * من يوم، فاستعلام الساعات كان **مستحيل** ياخد المدة الحقيقية لشغل ممتد — ويفضل يحسب مداه بيوم.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_080)
  duration_minutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  estimated_duration_days?: number;
}
