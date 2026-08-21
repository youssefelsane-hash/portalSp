import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsLatitude, IsLongitude, IsOptional, IsPositive, IsUUID } from 'class-validator';
import { DomesticWorkerSpecialty } from '../entities/domestic-worker-profile.entity';

export class BrowseWorkersQueryDto {
  @IsOptional()
  @IsEnum(DomesticWorkerSpecialty)
  specialty?: DomesticWorkerSpecialty;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  // ADR-0030 Slice C — تصفّح واعٍ بالتعارض الجدولي. لو اتحدد scheduled_at، الشغالات المتعارضة
  // بتتفلتر برّه القايمة إلا لو service_id بيرجّع لخدمة show_unavailable_providers=true (وقتها
  // بترجع بحالة schedule_conflicted بدل الإخفاء الكامل). service_id اختياري عمدًا (البحث هنا
  // بالتخصص مش بخدمة كتالوج بعينها) — بدونه الافتراضي الآمن هو الإخفاء (نفس سلوك الفلاج الافتراضي).
  @IsOptional()
  @IsUUID()
  service_id?: string;

  @IsOptional()
  @IsISO8601()
  scheduled_at?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  duration_hours?: number;
}
