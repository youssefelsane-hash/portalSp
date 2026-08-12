import { TechnicianScheduleSlot, TechnicianScheduleSlotStatus } from '../entities/technician-schedule-slot.entity';

export interface ScheduleSlotResponseDto {
  id: string;
  technician_id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  status: TechnicianScheduleSlotStatus;
  order_id: string | null;
  notes_ar: string | null;
  created_at: string;
}

export function toScheduleSlotResponseDto(slot: TechnicianScheduleSlot): ScheduleSlotResponseDto {
  return {
    id: slot.id,
    technician_id: slot.technicianId,
    slot_date: slot.slotDate,
    start_time: slot.startTime,
    end_time: slot.endTime,
    status: slot.status,
    order_id: slot.orderId,
    notes_ar: slot.notesAr,
    created_at: slot.createdAt.toISOString(),
  };
}

// نسخة العميل — "أخضر/أحمر" بس (booked وblocked الاتنين "مش متاح" من وجهة نظر العميل، مفيش
// داعي يعرف السبب)، مفيش order_id ولا notes_ar داخلية.
export interface PublicScheduleSlotResponseDto {
  id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

export function toPublicScheduleSlotResponseDto(slot: TechnicianScheduleSlot): PublicScheduleSlotResponseDto {
  return {
    id: slot.id,
    slot_date: slot.slotDate,
    start_time: slot.startTime,
    end_time: slot.endTime,
    is_available: slot.status === TechnicianScheduleSlotStatus.AVAILABLE,
  };
}
