import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { TechnicianLevel } from '../../technicians/entities/technician-profile.entity';

// هيكل الحجز الجديد (docs/06 §1) — التلات أزرار اللي العميل بيختار منهم قبل ما يشوف الخدمات.
// نفس القيم بالحرف زي orders.entity.ts's BookingMode (متعمّد تكرار بسيط بدل import من موديول
// orders جوّه catalog — الموديولين مستقلين عن بعض عمدًا في المشروع).
export type BookingModeFilter = 'individual' | 'team' | 'emergency';
export const BOOKING_MODE_FILTER_VALUES: BookingModeFilter[] = ['individual', 'team', 'emergency'];

export class ListServicesDto {
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsUUID()
  zone_id?: string;

  // فلترة الخدمات حسب وضع الحجز اللي اختاره العميل (فرد/اعتماد/طوارئ) — بتترجم لفلترة على
  // allows_individual/allows_team/allows_emergency على الخدمة (catalog.service.ts findServices).
  @IsOptional()
  @IsIn(BOOKING_MODE_FILTER_VALUES)
  booking_mode?: BookingModeFilter;
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
