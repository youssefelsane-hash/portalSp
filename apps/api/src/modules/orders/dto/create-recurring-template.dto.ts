import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { BookingMode } from '../entities/order.entity';
import { RecurringOrderFrequency } from '../entities/recurring-order-template.entity';

export class CreateRecurringTemplateDto {
  @IsUUID()
  service_id: string;

  @IsUUID()
  address_id: string;

  @IsOptional()
  @IsEnum(BookingMode)
  booking_mode?: BookingMode;

  @IsOptional()
  @IsUUID()
  requested_technician_id?: string;

  @IsEnum(RecurringOrderFrequency)
  frequency: RecurringOrderFrequency;

  // أول موعد تنفيذ — لازم يكون في المستقبل. المواعيد اللي بعد كده بتتحسب تلقائيًا من التردد.
  @IsDateString()
  starts_at: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  problem_description?: string;
}
