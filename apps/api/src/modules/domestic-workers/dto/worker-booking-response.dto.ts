import { DomesticWorkerBooking } from '../entities/domestic-worker-booking.entity';

export interface WorkerBookingResponseDto {
  id: string;
  booking_number: string;
  customer_id: string;
  worker_id: string;
  address_id: string;
  specialty: string;
  booking_type: string;
  scheduled_at: string;
  duration_hours: number | null;
  auto_renew: boolean;
  current_period_end_at: string | null;
  price_cents: number;
  status: string;
  customer_notes: string | null;
  /** الشغالة وافقت (status انتقل لـawaiting_payment) — منفصل عن confirmed_at (docs/adr/0019). */
  accepted_at: string | null;
  /** "الدفع اتأكد إداريًا عبر InstaPay" (إعادة تعريف دلالي، docs/adr/0019) — مش "الشغالة وافقت". */
  confirmed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
}

export function toWorkerBookingResponseDto(booking: DomesticWorkerBooking): WorkerBookingResponseDto {
  return {
    id: booking.id,
    booking_number: booking.bookingNumber,
    customer_id: booking.customerId,
    worker_id: booking.workerId,
    address_id: booking.addressId,
    specialty: booking.specialty,
    booking_type: booking.bookingType,
    scheduled_at: booking.scheduledAt.toISOString(),
    duration_hours: booking.durationHours,
    auto_renew: booking.autoRenew,
    current_period_end_at: booking.currentPeriodEndAt ? booking.currentPeriodEndAt.toISOString() : null,
    price_cents: booking.priceCents,
    status: booking.status,
    customer_notes: booking.customerNotes,
    accepted_at: booking.acceptedAt ? booking.acceptedAt.toISOString() : null,
    confirmed_at: booking.confirmedAt ? booking.confirmedAt.toISOString() : null,
    completed_at: booking.completedAt ? booking.completedAt.toISOString() : null,
    cancelled_at: booking.cancelledAt ? booking.cancelledAt.toISOString() : null,
    cancellation_reason: booking.cancellationReason,
    created_at: booking.createdAt.toISOString(),
  };
}
