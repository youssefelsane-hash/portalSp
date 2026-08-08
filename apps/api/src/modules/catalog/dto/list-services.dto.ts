import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TechnicianLevel } from '../../technicians/entities/technician-profile.entity';

export class ListServicesDto {
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsUUID()
  zone_id?: string;
}

export class EstimateQueryDto {
  @IsOptional()
  @IsUUID()
  zone_id?: string;

  // اختياري — لمعاينة السعر لو الفني اللي هيتنفّذ الطلب من مستوى معيّن (بيتطبّق بس لو فيه
  // service_level_pricing مفعّل للخدمة دي). التوصيل الفعلي في `POST /orders` لسه بيستخدم السعر
  // الأساسي لأن الفني مش معروف وقت إنشاء الطلب (فجوة موثّقة في catalog/README.md).
  @IsOptional()
  @IsEnum(TechnicianLevel)
  technician_level?: TechnicianLevel;
}
