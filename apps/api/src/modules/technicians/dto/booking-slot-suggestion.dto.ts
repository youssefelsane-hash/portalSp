import { IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SuggestedDaysQueryDto {
  @IsUUID()
  service_id!: string;

  /** العنوان مصدر النطاق — الخادم بيستنتج منه `service_zone_id` ومابيقبلوش من العميل. */
  @IsUUID()
  address_id!: string;

  /**
   * مدة الشغلانة الحقيقية لو الفورم حسبها بالفعل. من غيرها بنستخدم مدة الخدمة الافتراضية —
   * وساعتها الاقتراح بيبقى أوسع شوية من الواقع لشغلانة طويلة، وده مقبول لأنه اقتراح مش حجز.
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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  duration_minutes?: number;
}
