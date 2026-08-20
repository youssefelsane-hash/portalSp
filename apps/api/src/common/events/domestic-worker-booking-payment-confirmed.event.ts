// InstaPay اتأكدت إداريًا لحجز خدمة منزلية (docs/adr/0019) — بيتبعت بره أي DB transaction بعد نجاح
// PaymentsService.confirmInstaPayPayment()، نفس فلسفة emitPaymentConfirmedEvents. الاستماع في
// DomesticWorkerBookingsService (تسجيل استحقاق شهري PENDING) — نفس نمط PrepaidOrderSettlementListener
// (event-driven + sweep دوري كشبكة أمان لأي حدث ضاع أثناء انقطاع عابر).
export const DOMESTIC_WORKER_BOOKING_PAYMENT_CONFIRMED_EVENT = 'domestic_worker_booking.payment_confirmed';

export class DomesticWorkerBookingPaymentConfirmedEvent {
  constructor(
    public readonly bookingId: string,
    public readonly paymentId: string,
  ) {}
}
