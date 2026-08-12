import { IsDateString, IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { TechnicianScheduleSlotStatus } from '../entities/technician-schedule-slot.entity';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(:00)?$/;

export class CreateScheduleSlotDto {
  @IsDateString()
  slot_date: string;

  @IsString()
  @Matches(TIME_PATTERN, { message: 'start_time لازم يكون بصيغة HH:mm' })
  start_time: string;

  @IsString()
  @Matches(TIME_PATTERN, { message: 'end_time لازم يكون بصيغة HH:mm' })
  end_time: string;

  // الفني بس يقدر ينشئ available أو blocked (إجازة) — booked محجوزة داخليًا وقت الحجز الفعلي
  // (TechnicianScheduleService.bookSlot())، مش قيمة يبعتها الفني مباشرة.
  @IsOptional()
  @IsEnum([TechnicianScheduleSlotStatus.AVAILABLE, TechnicianScheduleSlotStatus.BLOCKED])
  status?: TechnicianScheduleSlotStatus.AVAILABLE | TechnicianScheduleSlotStatus.BLOCKED;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  notes_ar?: string;
}
