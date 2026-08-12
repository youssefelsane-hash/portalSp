import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { DomesticWorkerSpecialty } from '../entities/domestic-worker-profile.entity';
import { DomesticWorkerBookingType } from '../entities/domestic-worker-booking.entity';

export class CreateWorkerBookingDto {
  @IsUUID()
  worker_id: string;

  @IsUUID()
  address_id: string;

  @IsEnum(DomesticWorkerSpecialty)
  specialty: DomesticWorkerSpecialty;

  @IsEnum(DomesticWorkerBookingType)
  booking_type: DomesticWorkerBookingType;

  // بالساعة: وقت الزيارة. شهري: تاريخ بدء العقد. لازم في المستقبل في الحالتين.
  @IsDateString()
  scheduled_at: string;

  // لازم موجودة لو booking_type='hourly'، بتتجاهل لو 'monthly_live_in'.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  duration_hours?: number;

  // معنى بس لو booking_type='monthly_live_in'.
  @IsOptional()
  @IsBoolean()
  auto_renew?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customer_notes?: string;
}
